using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using CodeOrganism.Connector.DotNet;
using CodeOrganism.Protocol;
using CodeOrganism.Workload;

namespace CodeOrganism.Windows.Tests;

public class AllocationTests
{
    [Fact]
    public void UsesWeightedBytesOnceAndPreservesUnresolvedAndAbsentData()
    {
        var index = new ManagedCodeIndex();
        index.AddModule(1, @"C:\fixtures\Workload.dll");
        index.AddMethod(100, 10, new(1, 2, "Allocate", "Fixture", "()"));
        var buffer = new CpuBatchBuffer(10_000, index);
        buffer.Add(new AllocationSample(10_030, 105, 131_072));
        buffer.Add(new AllocationSample(10_040, 200, 40_000));
        buffer.Add(new AllocationSample(10_050, null, 12_000));
        buffer.Add(new CpuSample(10_075, index.Resolve(105), 3));

        var first = buffer.Take(12_000, 200)!;
        var method = first.Nodes.Single(x => x.Kind == NodeKind.Method);
        Assert.Contains(first.Measurements, x => x.NodeId == method.Id && x.Metric == Metric.Allocation &&
            x.Value == 131_072 && x.Quality == Quality.Estimated && x.Complete);
        Assert.Contains(first.Measurements, x => x.NodeId == method.Id && x.Metric == Metric.Cpu && x.Value == 3);
        var unresolved = first.Nodes.Single(x => x.Kind == NodeKind.Unresolved);
        Assert.Equal(52_000, first.Measurements.Single(x => x.NodeId == unresolved.Id).Value);
        Assert.Contains(first.Loss, x => x.Kind == LossKind.UnresolvedAttribution && x.Metric == Metric.Allocation);

        buffer.MarkAllocationLoss();
        var second = buffer.Take(12_300, 200)!;
        Assert.DoesNotContain(second.Measurements, x => x.Metric == Metric.Allocation);
        Assert.Contains(second.Loss, x => x.Kind == LossKind.SourceEvents && x.Metric == Metric.Allocation);
    }

    [ElevatedWindowsFact]
    public async Task FindsBothAllocationHotspotsAndMatchesReferenceDirection()
    {
        using var fixture = StartFixture();
        using var drain = new CancellationTokenSource();
        var references = new ConcurrentQueue<AllocationPhase>();
        var sink = ReadReferencesAsync();
        try
        {
            using var readiness = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (references.Count < 6)
                await Task.Delay(50, readiness.Token);

            using var duration = new CancellationTokenSource(TimeSpan.FromSeconds(9));
            var batches = new List<ConnectorBatch>();
            var result = await ObservationPublisher.CollectBatchesAsync(fixture.Id,
                fixture.StartTime.ToUniversalTime(), 200, (batch, _) =>
                {
                    batches.Add(batch);
                    return Task.CompletedTask;
                }, duration.Token, includeAllocations: true);

            Assert.True(result.Samples > 0);
            foreach (var method in new[] { "AllocateOrders", "AllocateInvoices" })
            {
                var reference = references.Where(x => x.Method == method).ToArray();
                Assert.True(reference.Where(x => x.Heavy).Average(x => x.Bytes) >
                    reference.Where(x => !x.Heavy).Average(x => x.Bytes) * 20);
            }

            var windows = batches.Select(batch =>
            {
                double Sum(string name)
                {
                    var ids = batch.Nodes.Where(x => x.Label == name).Select(x => x.Id).ToHashSet();
                    return batch.Measurements.Where(x => x.Metric == Metric.Allocation && ids.Contains(x.NodeId))
                        .Sum(x => x.Value ?? 0);
                }
                return (Orders: Sum("AllocateOrders"), Invoices: Sum("AllocateInvoices"));
            }).ToArray();
            var diag = string.Join(", ", windows.Select(x => $"{x.Orders:F0}/{x.Invoices:F0}"));
            Assert.True(windows.Count(x => x.Orders > 1_000_000 && x.Orders > 2 * x.Invoices) >= 2, diag);
            Assert.True(windows.Count(x => x.Invoices > 1_000_000 && x.Invoices > 2 * x.Orders) >= 2, diag);
            Assert.All(batches.SelectMany(x => x.Measurements).Where(x => x.Metric == Metric.Allocation),
                row => Assert.Equal(Quality.Estimated, row.Quality));
        }
        finally
        {
            drain.Cancel();
            if (!fixture.HasExited) fixture.Kill();
            await fixture.WaitForExitAsync();
            try { await sink; }
            catch (OperationCanceledException) when (drain.IsCancellationRequested) { }
        }

        async Task ReadReferencesAsync()
        {
            while (await fixture.StandardOutput.ReadLineAsync(drain.Token) is { } line)
            {
                if (line.Contains("\"method\"", StringComparison.Ordinal))
                    references.Enqueue(JsonSerializer.Deserialize<AllocationPhase>(line, JsonSerializerOptions.Web)!);
            }
        }
    }

    [ElevatedWindowsFact]
    public async Task TargetExitClosesTheConcurrentAllocationSession()
    {
        using var fixture = StartFixture();
        using var duration = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        Task? drain = null;
        try
        {
            Assert.NotNull(await fixture.StandardOutput.ReadLineAsync(duration.Token));
            drain = fixture.StandardOutput.ReadToEndAsync();
            var result = await ObservationPublisher.CollectBatchesAsync(fixture.Id,
                fixture.StartTime.ToUniversalTime(), 200, (batch, _) =>
                {
                    if (!fixture.HasExited && batch.Measurements.Any(row => row.Metric == Metric.Allocation))
                        fixture.Kill();
                    return Task.CompletedTask;
                }, duration.Token, includeAllocations: true);

            Assert.True(result.TargetExited);
        }
        finally
        {
            if (!fixture.HasExited) fixture.Kill();
            await fixture.WaitForExitAsync();
            if (drain is not null) await drain;
        }
    }

    private static Process StartFixture()
    {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true
        };
        var runtime = Path.Combine(AppContext.BaseDirectory, "CodeOrganism.Windows.Tests.runtimeconfig.json");
        foreach (var arg in new[] { "exec", "--runtimeconfig", runtime, typeof(AllocationScenario).Assembly.Location, "--allocations" })
            start.ArgumentList.Add(arg);
        return Process.Start(start)!;
    }
}
