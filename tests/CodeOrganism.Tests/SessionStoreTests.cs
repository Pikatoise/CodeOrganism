using CodeOrganism.Host;
using CodeOrganism.Protocol;

namespace CodeOrganism.Tests;

public class SessionStoreTests
{
    private static readonly ConnectorLimits Limits = new(100_000, 5, 3, 100, 1_000);
    private static readonly Registration Source = new("request", 1, new("publisher", "Publisher"),
        [new(Metric.Calls, "count", "entry", Quality.Exact)]);
    private static readonly GraphNode Module = new("module", NodeKind.Module, "Module");
    private static readonly GraphNode Method = new("method", NodeKind.Method, "Method", "module");

    [Fact]
    public void RejectsCompetingSourceAndRetriesRegistrationAndEnd()
    {
        var store = new SessionStore(new TestClock(), Limits);
        var session = store.Register(Source).Value!;
        Assert.Equal(session, store.Register(Source).Value);
        Assert.Equal("registration-conflict", store.Register(Source with { Source = Source.Source with { Label = "Changed" } }).Code);
        Assert.Equal("session-in-use", store.Register(Source with { RequestId = "other" }).Code);
        Assert.Null(store.End(session.SessionId, new(EndReason.Detached)).Code);
        Assert.Null(store.End(session.SessionId, new(EndReason.Detached)).Code);
        Assert.Equal(SessionStatus.Ended, store.Read().Snapshot!.State);
        Assert.NotEqual(session.SessionId, store.Register(Source with { RequestId = "other" }).Value!.SessionId);
    }

    [Fact]
    public void ReplayAndInvalidBatchesDoNotChangeSnapshot()
    {
        var clock = new TestClock();
        var store = new SessionStore(clock, Limits);
        var session = store.Register(Source).Value!.SessionId;
        var first = Batch(1, 0, [Module, Method]);
        Assert.Null(store.Publish(session, first).Code);
        var accepted = store.Read().Snapshot;

        Assert.Null(store.Publish(session, Batch(1, 0, [Module, Method])).Code);
        Assert.Equal("sequence-conflict", store.Publish(session, first with { EndMs = 150 }).Code);
        clock.Advance(100);
        Assert.Equal("invalid-reference", store.Publish(session, Batch(2, 100, [Method with { Id = "new", ParentId = "unknown" }])).Code);
        Assert.Equal(accepted, store.Read().Snapshot);
        Assert.Null(store.Publish(session, Batch(2, 100, [])).Code);
    }

    [Fact]
    public async Task SlowReaderGetsOnlyLatestSnapshotAndGapRemainsVisible()
    {
        var clock = new TestClock();
        var store = new SessionStore(clock, Limits);
        var session = store.Register(Source).Value!.SessionId;
        var reader = store.Read();
        Assert.Null(store.Publish(session, Batch(1, 0, [Module, Method])).Code);
        clock.Advance(100);
        var skipped = Batch(3, 200, []) with { Loss = [new(LossKind.SourceGap)] };
        Assert.Null(store.Publish(session, skipped).Code);
        await reader.Changed.WaitAsync(TimeSpan.FromSeconds(1));

        var snapshot = store.Read().Snapshot!;
        Assert.Equal(200, snapshot.StartMs);
        Assert.Equal(1, snapshot.Gaps);
        Assert.True(snapshot.Measurements.Single(x => x.NodeId == "method").Complete);
        Assert.Equal(2, snapshot.Nodes.Length);

        clock.Advance(100);
        Assert.Null(store.Publish(session, Batch(4, 300, [])).Code);
        Assert.Equal(1, store.Read().Snapshot!.Gaps);
    }

    [Fact]
    public void RollsUpCoveredMethodsAndReportsTruncation()
    {
        var store = new SessionStore(new TestClock(), Limits);
        var session = store.Register(Source).Value!.SessionId;
        var other = Method with { Id = "other" };
        var batch = Batch(1, 0, [Module, Method, other, Method with { Id = "third" }, Method with { Id = "discarded" }]);
        batch = batch with { Measurements = [.. batch.Measurements, new("discarded", Metric.Calls, 3, Quality.Exact, true)] };
        Assert.Null(store.Publish(session, batch).Code);

        var snapshot = store.Read().Snapshot!;
        Assert.Equal(5, snapshot.Nodes.Length);
        Assert.Contains(snapshot.Loss, x => x.Kind == LossKind.TopologyLimit);
        Assert.Contains(snapshot.Measurements, x => x.NodeId == "module" && x.Value == 2 && !x.Complete);
        Assert.Contains(snapshot.Measurements, x => x.NodeId == "$unresolved" && x.Value == 3 && !x.Complete);
    }

    [Fact]
    public void EnforcesCadenceAndReleasesAnExpiredSource()
    {
        var clock = new TestClock();
        var store = new SessionStore(clock, Limits);
        var session = store.Register(Source).Value!.SessionId;
        Assert.Null(store.Publish(session, Batch(1, 0, [Module, Method])).Code);
        Assert.Equal("ingress-busy", store.Publish(session, Batch(2, 100, [])).Code);
        clock.Advance(1_000);
        Assert.Equal(SessionStatus.Failed, store.Read().Snapshot!.State);
        Assert.NotNull(store.Register(Source with { RequestId = "second" }).Value);
    }

    private static ConnectorBatch Batch(long sequence, long start, GraphNode[] nodes) =>
        new(sequence, start, start + 100, nodes, [], [new("method", Metric.Calls, 2, Quality.Exact, true)], []);

    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UnixEpoch;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(int milliseconds) => now = now.AddMilliseconds(milliseconds);
    }
}
