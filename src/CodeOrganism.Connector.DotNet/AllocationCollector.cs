using System.Diagnostics.Tracing;
using Microsoft.Diagnostics.NETCore.Client;
using Microsoft.Diagnostics.Tracing.Etlx;
using Microsoft.Diagnostics.Tracing.Parsers;

namespace CodeOrganism.Connector.DotNet;

public sealed record AllocationSample(long TimestampMs, ulong? Address, long Bytes);

public static class AllocationCollector
{
    public const string MeasurementMethod = "dotnet-eventpipe-allocation-ticks";
    private static readonly EventPipeProvider Provider = new(ClrTraceEventParser.ProviderName, EventLevel.Verbose,
        (long)ClrTraceEventParser.Keywords.GC);

    public static async Task CaptureAsync(int pid, Action<AllocationSample> publish, Action markLoss, CancellationToken stop)
    {
        var client = new DiagnosticsClient(pid);
        while (!stop.IsCancellationRequested)
        {
            using var session = await client.StartEventPipeSessionAsync(Provider, false, 16, stop);
            // TraceLog exposes EventPipe stack instruction addresses. ETW provides the shared managed-code identities.
            using var source = TraceLog.CreateFromEventPipeSession(session);
            var lastLoss = 0;
            source.Clr.GCAllocationTick += entry =>
            {
                if (stop.IsCancellationRequested || entry.AllocationAmount64 <= 0)
                    return;

                var leaf = entry.CallStack()?.CodeAddress;
                publish(new(new DateTimeOffset(entry.TimeStamp).ToUnixTimeMilliseconds(),
                    leaf is null ? null : (ulong)leaf.Address, entry.AllocationAmount64));
                if (source.EventsLost > lastLoss)
                {
                    lastLoss = source.EventsLost;
                    markLoss();
                }
            };

            var reader = Task.Factory.StartNew(source.Process, CancellationToken.None,
                TaskCreationOptions.LongRunning, TaskScheduler.Default);
            // Rotate the parser to bound its retained stack metadata even in a long session.
            using var rotation = CancellationTokenSource.CreateLinkedTokenSource(stop);
            var expiry = Task.Delay(TimeSpan.FromMinutes(1), rotation.Token);
            if (await Task.WhenAny(reader, expiry) == reader)
            {
                rotation.Cancel();
                await reader;
                if (!stop.IsCancellationRequested) markLoss();
                return;
            }

            using var shutdown = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await session.StopAsync(shutdown.Token); }
            catch (Exception error) when (error is DiagnosticsClientException or IOException or OperationCanceledException) { }
            finally { session.Dispose(); }
            try { await reader; }
            catch (Exception error) when (error is IOException or ObjectDisposedException) { }
            if (!stop.IsCancellationRequested) markLoss();
        }
    }
}
