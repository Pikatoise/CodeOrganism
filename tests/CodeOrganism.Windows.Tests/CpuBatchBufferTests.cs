using CodeOrganism.Connector.DotNet;
using CodeOrganism.Protocol;

namespace CodeOrganism.Windows.Tests;

public class CpuBatchBufferTests
{
    [Fact]
    public void AttributesOnlyExecutingMethodAndDoesNotBridgeUnknownFrames()
    {
        var buffer = new CpuBatchBuffer(10_000);
        var leaf = new CpuMethod(1, 2, "Busy", "Harness", "", "Workload");
        var caller = leaf with { MethodId = 3, Name = "Caller" };
        buffer.Add(new CpuSample(10_030, leaf, 2));
        buffer.Add(new CpuSample(10_040, null, 1));
        buffer.Add(new CpuStack(10_030, [leaf, caller]));
        buffer.Add(new CpuStack(10_040, [leaf, null, caller with { MethodId = 4 }]));

        var first = buffer.Take(12_000, 200)!;

        var edge = Assert.Single(first.Relationships);
        Assert.Equal("method-1-3", edge.SourceId);
        Assert.Equal("method-1-2", edge.TargetId);
        Assert.Equal(Evidence.StackAdjacency, edge.Evidence);
        Assert.Contains(first.Measurements, x => x.Value == 2 && x.NodeId == edge.TargetId);
        Assert.DoesNotContain(first.Measurements, x => x.NodeId == edge.SourceId);
        Assert.Contains(first.Loss, x => x.Kind == LossKind.UnresolvedAttribution);

        buffer.Add(new CpuSample(10_040, leaf, 1));
        buffer.Add(new CpuSample(10_420, leaf, 1));
        var second = buffer.Take(12_300, 200)!;
        Assert.Equal(first.EndMs, second.StartMs);
        Assert.Contains(second.Loss, x => x.Kind == LossKind.SourceEvents && x.Count == 1);
        Assert.False(Assert.Single(second.Measurements).Complete);
    }
}
