using System.Diagnostics;
using System.Net;
using CodeOrganism.Protocol;

namespace CodeOrganism.Connector.DotNet;

public static class ObservationPublisher
{
    public static async Task<CpuCaptureResult> RunAsync(ConnectorClient client, int pid, DateTime startUtc, CancellationToken stop)
    {
        using var target = Process.GetProcessById(pid);
        var registration = new Registration(Guid.NewGuid().ToString("N"), ConnectorMessages.Version,
            new($"dotnet-{pid}-{startUtc.Ticks}", target.ProcessName, $"PID {pid}"),
            [new(Metric.Cpu, "ms", "windows-etw-on-cpu-sampling", Quality.Estimated)]);
        var reply = await client.RegisterAsync(registration, stop);
        var session = reply.Session ?? throw ConnectionError(reply);
        var buffer = new CpuBatchBuffer(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        using var captureStop = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var capture = Task.Factory.StartNew(
            () => CpuCollector.Capture(pid, startUtc, buffer.Add, captureStop.Token, buffer.Add),
            CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        var reason = EndReason.ProducerError;
        var cadence = Math.Max(200, session.Limits.MinIntervalMs);
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(cadence));
            while (!capture.IsCompleted && await WaitForTickAsync(timer, stop))
            {
                var batch = buffer.Take(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), cadence);
                if (batch is null)
                    continue;

                var published = await client.PublishAsync(session.SessionId, batch, stop);
                if (!published.IsSuccess && published.Status != HttpStatusCode.TooManyRequests && (int)published.Status < 500)
                    throw ConnectionError(published);
            }

            var result = await capture;
            reason = result.TargetExited ? EndReason.TargetExited : EndReason.Detached;
            return result;
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
            reason = EndReason.Detached;
            return await capture;
        }
        finally
        {
            captureStop.Cancel();
            try
            {
                if (!capture.IsCompleted)
                    await capture;
            }
            catch (OperationCanceledException) when (captureStop.IsCancellationRequested) { }
            finally
            {
                using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try { await client.EndAsync(session.SessionId, new(reason), cleanup.Token); }
                catch (OperationCanceledException) when (cleanup.IsCancellationRequested) { }
            }
        }
    }

    private static async Task<bool> WaitForTickAsync(PeriodicTimer timer, CancellationToken stop)
    {
        try { return await timer.WaitForNextTickAsync(stop); }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { return false; }
    }

    private static InvalidOperationException ConnectionError(ConnectorReply reply) =>
        new($"The local visualizer rejected the connector request ({(int)reply.Status}, {reply.Error?.Code ?? "unknown"}).");
}

public sealed class CpuBatchBuffer(long epochMs)
{
    private const int MaxBufferedEvents = 12_000;
    private const int MaxNodesPerBatch = 300;
    private const int MaxEdgesPerBatch = 500;
    private const string UnknownNode = "unmapped-cpu";
    private readonly object gate = new();
    private readonly List<CpuSample> samples = [];
    private readonly List<CpuStack> stacks = [];
    private long newest;
    private long end;
    private long sequence;
    private long dropped;

    public void Add(CpuSample sample)
    {
        lock (gate)
        {
            if (sample.TimestampMs - epochMs < end || samples.Count == MaxBufferedEvents)
                dropped++;
            else
            {
                samples.Add(sample);
                newest = Math.Max(newest, sample.TimestampMs);
            }
        }
    }

    public void Add(CpuStack stack)
    {
        lock (gate)
        {
            if (stack.TimestampMs - epochMs < end || stacks.Count == MaxBufferedEvents)
                dropped++;
            else
                stacks.Add(stack);
        }
    }

    public ConnectorBatch? Take(long now, int cadenceMs)
    {
        CpuSample[] ready;
        CpuStack[] walks;
        long from, through, next, lost;
        lock (gate)
        {
            // Allow modest reordering. The wall clock also advances an idle source's heartbeat.
            var watermark = Math.Max(newest - 150, now - 1_600) - epochMs;
            if (watermark - end < cadenceMs)
                return null;

            from = end;
            end = through = watermark;
            next = ++sequence;
            lost = dropped;
            dropped = 0;
            ready = [.. samples.Where(x => x.TimestampMs - epochMs < through)];
            walks = [.. stacks.Where(x => x.TimestampMs - epochMs < through)];
            samples.RemoveAll(x => x.TimestampMs - epochMs < through);
            stacks.RemoveAll(x => x.TimestampMs - epochMs < through);
        }

        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new HashSet<GraphRelationship>();
        var totals = new Dictionary<string, double>(StringComparer.Ordinal);
        var truncated = false;
        foreach (var sample in ready)
        {
            var id = sample.Method is { } method ? Include(method) : null;
            if (id is null)
            {
                id = UnknownNode;
                nodes.TryAdd(id, new(id, NodeKind.Unresolved, "Unresolved CPU"));
            }

            totals[id] = totals.GetValueOrDefault(id) + sample.CpuMilliseconds;
        }

        foreach (var walk in walks)
        {
            for (var i = 1; i < walk.Frames.Length; i++)
            {
                if (walk.Frames[i] is not { } caller || walk.Frames[i - 1] is not { } callee ||
                    Include(caller) is not { } fromId || Include(callee) is not { } toId)
                    continue;

                if (edges.Count < MaxEdgesPerBatch)
                    edges.Add(new(fromId, toId, Evidence.StackAdjacency));
                else
                    truncated = true;
            }
        }

        var loss = new List<MeasurementLoss>();
        if (lost > 0)
            loss.Add(new(LossKind.SourceEvents, Metric.Cpu, lost));
        if (truncated)
            loss.Add(new(LossKind.TopologyLimit, Metric.Cpu));
        if (totals.ContainsKey(UnknownNode))
            loss.Add(new(LossKind.UnresolvedAttribution, Metric.Cpu));

        var observations = totals.Select(x => new Observation(x.Key, Metric.Cpu, x.Value, Quality.Estimated, lost == 0)).ToArray();
        return new(next, from, through, [.. nodes.Values], [.. edges], observations, [.. loss]);

        string? Include(CpuMethod method)
        {
            var moduleId = $"module-{method.ModuleId:x}";
            var id = $"method-{method.ModuleId:x}-{method.MethodId:x}";
            if (nodes.ContainsKey(id))
                return id;
            if (nodes.Count >= MaxNodesPerBatch - 2)
            {
                truncated = true;
                return null;
            }

            var moduleName = method.ModuleName ?? (string.IsNullOrWhiteSpace(method.TypeName)
                ? "Managed module" : method.TypeName.Split('.')[0]);
            nodes.TryAdd(moduleId, new(moduleId, NodeKind.Module, ShortLabel(moduleName)));
            var methodLabel = string.IsNullOrWhiteSpace(method.Name) ? id : method.Name;
            nodes.Add(id, new(id, NodeKind.Method, ShortLabel(methodLabel), moduleId));
            return id;
        }
    }

    private static string ShortLabel(string value) => value.Length > 96 ? value[..96] : value;
}
