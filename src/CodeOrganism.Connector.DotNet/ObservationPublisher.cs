using System.Diagnostics;
using System.Net;
using CodeOrganism.Protocol;
using Microsoft.Diagnostics.NETCore.Client;

namespace CodeOrganism.Connector.DotNet;

public static class ObservationPublisher
{
    public static async Task<CpuCaptureResult> RunAsync(ConnectorClient client, int pid, DateTime startUtc, CancellationToken stop,
        Func<int, Func<ConnectorBatch, CancellationToken, Task>, CancellationToken, Task<CpuCaptureResult>>? collect = null,
        bool includeAllocations = false)
    {
        using var target = Process.GetProcessById(pid);
        var cpu = new MetricCapability(Metric.Cpu, "ms", "windows-etw-on-cpu-sampling", Quality.Estimated);
        MetricCapability[] capabilities = includeAllocations
            ? [cpu, new(Metric.Allocation, "byte", AllocationCollector.MeasurementMethod, Quality.Estimated)]
            : [cpu];
        var registration = new Registration(Guid.NewGuid().ToString("N"), ConnectorMessages.Version,
            new($"dotnet-{pid}-{startUtc.Ticks}", target.ProcessName, $"PID {pid}"),
            capabilities);
        RegisteredSession? session = collect is null ? await RegisterAsync(stop) : null;
        var reason = EndReason.ProducerError;
        var cadence = Math.Max(200, session?.Limits.MinIntervalMs ?? 0);
        try
        {
            var result = collect is null
                ? await CollectBatchesAsync(pid, startUtc, cadence, Publish, stop, includeAllocations)
                : await collect(cadence, Publish, stop);
            reason = result.TargetExited ? EndReason.TargetExited : EndReason.Detached;
            return result;
        }
        catch (AttachException error) when (error.Code == "target-exited")
        {
            reason = EndReason.TargetExited;
            throw;
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
            reason = EndReason.Detached;
            throw;
        }
        finally
        {
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try
            {
                if (session is not null)
                    await client.EndAsync(session.SessionId, new(reason), cleanup.Token);
            }
            catch (OperationCanceledException) when (cleanup.IsCancellationRequested) { }
        }

        async Task Publish(ConnectorBatch batch, CancellationToken active)
        {
            session ??= await RegisterAsync(active);
            var published = await client.PublishAsync(session.SessionId, batch, active);
            if (!published.IsSuccess && published.Status != HttpStatusCode.TooManyRequests && (int)published.Status < 500)
                throw ConnectionError(published);
        }

        async Task<RegisteredSession> RegisterAsync(CancellationToken active)
        {
            var reply = await client.RegisterAsync(registration, active);
            return reply.Session ?? throw ConnectionError(reply);
        }
    }

    public static async Task<CpuCaptureResult> CollectBatchesAsync(int pid, DateTime startUtc, int cadence,
        Func<ConnectorBatch, CancellationToken, Task> publish, CancellationToken stop, bool includeAllocations = false)
    {
        var index = new ManagedCodeIndex();
        var buffer = new CpuBatchBuffer(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), index);
        using var captureStop = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var capture = Task.Factory.StartNew(
            () => CpuCollector.Capture(pid, startUtc, buffer.Add, captureStop.Token, buffer.Add, index),
            CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        var allocations = includeAllocations ? CollectAllocationsAsync() : Task.CompletedTask;
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(cadence));
            while (!capture.IsCompleted && await WaitForTickAsync(timer, stop))
            {
                if (buffer.Take(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), cadence) is { } batch)
                    await publish(batch, stop);
            }

            return await capture;
        }
        finally
        {
            captureStop.Cancel();
            if (!capture.IsCompleted)
            {
                try { await capture; }
                catch (OperationCanceledException) when (captureStop.IsCancellationRequested) { }
            }
            await allocations;
        }

        async Task CollectAllocationsAsync()
        {
            try { await AllocationCollector.CaptureAsync(pid, buffer.Add, buffer.MarkAllocationLoss, captureStop.Token); }
            catch (OperationCanceledException) when (captureStop.IsCancellationRequested) { }
            catch (Exception error) when (error is DiagnosticsClientException or IOException or ObjectDisposedException or FormatException)
            {
                // A target that exits mid-block can leave a truncated EventPipe stream.
                // CPU collection owns the target lifecycle and still reports that exit.
                if (!captureStop.IsCancellationRequested) buffer.MarkAllocationLoss();
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

public sealed class CpuBatchBuffer(long epochMs, ManagedCodeIndex? code = null)
{
    private const int MaxBufferedEvents = 12_000;
    private const int MaxNodesPerBatch = 300;
    private const int MaxEdgesPerBatch = 500;
    private readonly object gate = new();
    private readonly List<CpuSample> samples = [];
    private readonly List<CpuStack> stacks = [];
    private readonly List<AllocationSample> allocations = [];
    private long newest;
    private long end;
    private long sequence;
    private long dropped;
    private bool allocationLoss;

    public void Add(AllocationSample sample)
    {
        lock (gate)
        {
            if (sample.TimestampMs - epochMs < end || allocations.Count == MaxBufferedEvents)
                allocationLoss = true;
            else
                allocations.Add(sample);
        }
    }

    public void MarkAllocationLoss()
    {
        lock (gate)
            allocationLoss = true;
    }

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
        AllocationSample[] allocated;
        bool allocationsIncomplete;
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
            allocationsIncomplete = allocationLoss;
            allocationLoss = false;
            ready = [.. samples.Where(x => x.TimestampMs - epochMs < through)];
            walks = [.. stacks.Where(x => x.TimestampMs - epochMs < through)];
            allocated = [.. allocations.Where(x => x.TimestampMs - epochMs < through)];
            samples.RemoveAll(x => x.TimestampMs - epochMs < through);
            stacks.RemoveAll(x => x.TimestampMs - epochMs < through);
            allocations.RemoveAll(x => x.TimestampMs - epochMs < through);
        }

        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new HashSet<GraphRelationship>();
        var totals = new Dictionary<(string Node, Metric Metric), double>();
        var unattributed = new HashSet<Metric>();
        var truncated = false;
        foreach (var sample in ready)
            AddValue(sample.Method, Metric.Cpu, sample.CpuMilliseconds);
        foreach (var sample in allocated)
            AddValue(sample.Address is { } address ? code?.Resolve(address) : null, Metric.Allocation, sample.Bytes);

        void AddValue(CpuMethod? method, Metric metric, double value)
        {
            var id = method is not null ? Include(method) : null;
            if (id is null)
            {
                id = metric == Metric.Cpu ? "unmapped-cpu" : "unmapped-allocation";
                nodes.TryAdd(id, new(id, NodeKind.Unresolved, metric == Metric.Cpu ? "Unresolved CPU" : "Unresolved allocations"));
                unattributed.Add(metric);
            }

            var key = (id, metric);
            totals[key] = totals.GetValueOrDefault(key) + value;
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
        if (allocationsIncomplete)
            loss.Add(new(LossKind.SourceEvents, Metric.Allocation));
        if (truncated)
            loss.Add(new(LossKind.TopologyLimit));
        foreach (var metric in unattributed)
            loss.Add(new(LossKind.UnresolvedAttribution, metric));

        var observations = totals.Select(x => new Observation(x.Key.Node, x.Key.Metric, x.Value, Quality.Estimated,
            x.Key.Metric == Metric.Allocation ? !allocationsIncomplete : lost == 0)).ToArray();
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
            nodes.TryAdd(moduleId, new(moduleId, NodeKind.Module, ShortLabel(moduleName), Library: method.Library));
            var methodLabel = string.IsNullOrWhiteSpace(method.Name) ? id : method.Name;
            nodes.Add(id, new(id, NodeKind.Method, ShortLabel(methodLabel), moduleId));
            return id;
        }
    }

    private static string ShortLabel(string value) => value.Length > 96 ? value[..96] : value;
}
