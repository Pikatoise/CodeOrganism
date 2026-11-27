using System.Diagnostics;
using CodeOrganism.CallProbes;
using CodeOrganism.Connector.DotNet;
using CodeOrganism.Protocol;

namespace CodeOrganism.Windows.Tests;

public class CallProbeTests
{
    [Fact]
    public void CountsBaselineAndCheckpointWindowsWithoutOverlappingAcceptedBatches()
    {
        var buffer = new CpuBatchBuffer(10_000, discoverCalls: true);
        var module = Guid.NewGuid();
        var source = Guid.NewGuid().ToString("N");
        void Add(long sequence, long timestamp, long count) =>
            buffer.Add(new EntryCounters.Checkpoint(source, sequence, timestamp, [new(1, module, "Fixture", "Entry", count)]));

        Add(1, 10_250, 20);
        var first = buffer.Take(11_900, 200)!;
        Assert.Equal(250, first.EndMs);
        Assert.Equal(Quality.Unavailable, CallRow(first).Quality);

        Add(2, 10_500, 25);
        var aligned = buffer.Take(12_150, 200)!;
        Assert.Equal((250L, 500L), (aligned.StartMs, aligned.EndMs));
        Assert.Equal(5d, CallRow(aligned).Value);
        Assert.True(CallRow(aligned).Complete);

        var missing = buffer.Take(13_250, 200)!;
        Assert.Equal((500L, 900L), (missing.StartMs, missing.EndMs));
        Assert.Null(CallRow(missing).Value);
        Assert.Contains(missing.Loss, x => x.Kind == LossKind.SourceEvents && x.Metric == Metric.Calls);

        Add(4, 11_000, 50);
        Add(5, 11_250, 59);
        var partial = buffer.Take(13_500, 200)!;
        Assert.Equal((900L, 1250L), (partial.StartMs, partial.EndMs));
        Assert.Equal(9d, CallRow(partial).Value);
        Assert.False(CallRow(partial).Complete);

        Add(6, 11_500, 59);
        var idle = buffer.Take(13_500, 200)!;
        Assert.Equal(0d, CallRow(idle).Value);
        Assert.True(CallRow(idle).Complete);

        var zeroWithoutCoverage = new CpuBatchBuffer(10_000, discoverCalls: true);
        zeroWithoutCoverage.Add(new EntryCounters.Checkpoint(source, 1, 10_100, [new(1, module, "Fixture", "Entry", 20)]));
        zeroWithoutCoverage.Add(new EntryCounters.Checkpoint(source, 2, 10_350, [new(1, module, "Fixture", "Entry", 20)]));
        var unproven = zeroWithoutCoverage.Take(12_000, 200)!;
        Assert.Null(CallRow(unproven).Value);
        Assert.Null(ConnectorMessages.Validate(unproven));
    }

    [PreparedWindowsFact]
    public async Task WarmPreparedTargetPublishesExactConcurrentRecursiveAndThrowingEntries()
    {
        const int loops = 50_000;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(18));
        var stop = timeout.Token;
        using var process = StartPreparedTarget();
        try
        {
            Assert.NotNull(await process.StandardOutput.ReadLineAsync(stop));
            await RunAsync(1_000);
            var firstCovered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var collected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var totals = new Dictionary<string, long>();
            using var captureStop = CancellationTokenSource.CreateLinkedTokenSource(stop);
            var capture = ObservationPublisher.CollectBatchesAsync(process.Id, process.StartTime.ToUniversalTime(), 200, (batch, _) =>
            {
                Assert.Null(ConnectorMessages.Validate(batch));
                var rows = batch.Measurements.Where(x => x.Metric == Metric.Calls && x.Value.HasValue).ToArray();
                if (rows.Length == 3 && rows.All(x => x.Complete && x.Value == 0)) firstCovered.TrySetResult();
                foreach (var row in rows.Where(x => x.Complete))
                {
                    var name = batch.Nodes.Single(x => x.Id == row.NodeId).Label;
                    totals[name] = totals.GetValueOrDefault(name) + (long)row.Value!.Value;
                }
                if (totals.GetValueOrDefault("ConcurrentEntry") >= 4 * loops && rows.All(x => x.Value == 0))
                    collected.TrySetResult();
                return Task.CompletedTask;
            }, captureStop.Token, includeAllocations: true);

            try
            {
                await firstCovered.Task.WaitAsync(stop);
                await RunAsync(loops);
                await collected.Task.WaitAsync(stop);
            }
            finally
            {
                await captureStop.CancelAsync();
                await capture;
            }

            Assert.Equal(4 * loops, totals["ConcurrentEntry"]);
            Assert.Equal(12 * loops, totals["RecursiveEntry"]);
            Assert.Equal(4 * loops / 100, totals["ThrowingEntry"]);
            Assert.Equal(3, totals.Count);
        }
        finally
        {
            if (!process.HasExited) process.Kill();
            await process.WaitForExitAsync();
        }

        async Task RunAsync(int iterations)
        {
            await process.StandardInput.WriteLineAsync(iterations.ToString());
            Assert.Contains("elapsedMs", await process.StandardOutput.ReadLineAsync(stop));
        }
    }

    private static Observation CallRow(ConnectorBatch batch) => Assert.Single(batch.Measurements, x => x.Metric == Metric.Calls);

    private static Process StartPreparedTarget()
    {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            CreateNoWindow = true, UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true
        };
        start.ArgumentList.Add(Environment.GetEnvironmentVariable("CODEORGANISM_TEST_CALL_TARGET")!);
        start.ArgumentList.Add("--calls");
        return Process.Start(start)!;
    }

    private sealed class PreparedWindowsFactAttribute : FactAttribute
    {
        public PreparedWindowsFactAttribute() => Skip = new ElevatedWindowsFactAttribute().Skip ??
            (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CODEORGANISM_TEST_CALL_TARGET"))
                ? "Set CODEORGANISM_TEST_CALL_TARGET to the prepared Workload.Console.dll." : null);
    }
}
