using System.Security.Cryptography;
using System.Text.Json;
using CodeOrganism.Protocol;

namespace CodeOrganism.Host;

public enum SessionStatus { Connecting, Live, Ended, Failed }

public readonly record struct StoreResult(int Status, string? Code = null, RegisteredSession? Value = null);
public readonly record struct SnapshotRead(MapSnapshot? Snapshot, Task Changed);

public sealed class SessionStore(TimeProvider clock, ConnectorLimits limits)
{
    private const string UnresolvedId = "$unresolved";
    private readonly object gate = new();
    private readonly Dictionary<string, GraphNode> nodes = new(StringComparer.Ordinal);
    private readonly HashSet<GraphRelationship> relationships = [];
    private readonly Dictionary<(string NodeId, Metric Metric), MethodPeak> methodPeaks = [];
    private TaskCompletionSource changed = NewSignal();
    private MapSnapshot? snapshot;
    private RegisteredSession? session;
    private string? sourceId;
    private string? requestId;
    private byte[]? registrationHash;
    private byte[]? lastBatchHash;
    private long lastSequence;

    public StoreResult Register(Registration registration)
    {
        if (ConnectorMessages.Validate(registration) is { } invalid)
            return new(invalid == "unsupported-version" ? 409 : 400, invalid);

        var hash = Fingerprint(registration);
        lock (gate)
        {
            ExpireIfSilent();
            if (sourceId == registration.Source.Id && requestId == registration.RequestId)
                return Matches(registrationHash, hash) ? new(201, Value: session) : new(409, "registration-conflict");
            if (IsActive)
                return new(409, "session-in-use");

            nodes.Clear();
            relationships.Clear();
            methodPeaks.Clear();
            sourceId = registration.Source.Id;
            requestId = registration.RequestId;
            registrationHash = hash;
            lastBatchHash = null;
            lastSequence = 0;
            session = new(Guid.NewGuid().ToString("N"), limits);
            SetSnapshot(new(session.SessionId, 1, SessionStatus.Connecting, registration.Source,
                registration.Capabilities, null, null, [], [], [], [], 0, clock.GetUtcNow(), null, []));
            return new(201, Value: session);
        }
    }

    public StoreResult Publish(string id, ConnectorBatch batch)
    {
        if (ConnectorMessages.Validate(batch) is { } invalid)
            return new(400, invalid);

        var hash = Fingerprint(batch);
        lock (gate)
        {
            ExpireIfSilent();
            if (session?.SessionId != id || snapshot is not { } current)
                return new(404, "unknown-session");
            if (batch.Sequence == lastSequence)
                return Matches(lastBatchHash, hash) ? new(202) : new(409, "sequence-conflict");
            if (!IsActive)
                return new(409, "session-ended");
            if (batch.Sequence < lastSequence || batch.StartMs < current.EndMs)
                return new(409, "sequence-conflict");
            if (lastSequence > 0 && (clock.GetUtcNow() - current.LastUpdate).TotalMilliseconds < limits.MinIntervalMs)
                return new(429, "ingress-busy");

            var incoming = batch.Nodes.ToDictionary(x => x.Id, StringComparer.Ordinal);
            if (!HasValidReferences(batch, incoming, current.Capabilities))
                return new(400, "invalid-reference");

            var truncated = AdmitNodes(batch.Nodes);
            foreach (var edge in batch.Relationships)
            {
                if (!nodes.ContainsKey(edge.SourceId) || !nodes.ContainsKey(edge.TargetId) ||
                    (relationships.Count >= limits.MaxRelationships && !relationships.Contains(edge)))
                {
                    truncated = true;
                    continue;
                }

                relationships.Add(edge);
            }

            var hasGap = batch.Sequence - lastSequence > 1 || batch.StartMs > (current.EndMs ?? 0) ||
                batch.Loss.Any(x => x.Kind == LossKind.SourceGap);
            var loss = batch.Loss.ToList();
            if (hasGap && !loss.Any(x => x.Kind == LossKind.SourceGap))
                loss.Add(new(LossKind.SourceGap));
            if (truncated && !loss.Any(x => x.Kind == LossKind.TopologyLimit))
                loss.Add(new(LossKind.TopologyLimit));

            var observations = batch.Measurements.Where(x => nodes.ContainsKey(x.NodeId)).ToList();
            var affected = loss.Where(x => x.Kind == LossKind.SourceEvents).Select(x => x.Metric).ToHashSet();
            for (var i = 0; i < observations.Count; i++)
            {
                var observation = observations[i];
                if (affected.Contains(null) || affected.Contains(observation.Metric))
                    observations[i] = observation.Value == 0
                        ? observation with { Value = null, Quality = Quality.Unavailable, Complete = false }
                        : observation with { Complete = false };
            }

            if (truncated)
            {
                foreach (var group in batch.Measurements.Where(x => !nodes.ContainsKey(x.NodeId)).GroupBy(x => x.Metric))
                {
                    nodes.TryAdd(UnresolvedId, new(UnresolvedId, NodeKind.Unresolved, "Unresolved (topology limit)"));
                    observations.Add(SnapshotStream.Aggregate(UnresolvedId, group.Key, group, complete: false));
                }
            }

            var measured = SnapshotStream.WithRollups(nodes.Values, observations, loss);
            var peaksChanged = RememberMethodPeaks(observations, batch.StartMs, batch.EndMs);
            lastSequence = batch.Sequence;
            lastBatchHash = hash;
            SetSnapshot(current with
            {
                Version = current.Version + 1,
                State = SessionStatus.Live,
                StartMs = batch.StartMs,
                EndMs = batch.EndMs,
                Nodes = [.. nodes.Values],
                Relationships = [.. relationships],
                Measurements = measured,
                MethodPeaks = peaksChanged ? [.. methodPeaks.Values] : current.MethodPeaks,
                Loss = [.. loss],
                Gaps = current.Gaps + (hasGap ? 1 : 0),
                LastUpdate = clock.GetUtcNow()
            });
            return new(202);
        }
    }

    public StoreResult End(string id, EndSession request)
    {
        lock (gate)
        {
            ExpireIfSilent();
            if (session?.SessionId != id || snapshot is not { } current)
                return new(404, "unknown-session");

            if (IsActive)
            {
                var state = request.Reason == EndReason.ProducerError ? SessionStatus.Failed : SessionStatus.Ended;
                SetSnapshot(current with { State = state, Version = current.Version + 1, EndReason = ReasonText(request.Reason) });
            }

            return new(200);
        }
    }

    public SnapshotRead Read()
    {
        lock (gate)
        {
            ExpireIfSilent();
            return new(snapshot, changed.Task);
        }
    }

    private bool IsActive => snapshot?.State is SessionStatus.Connecting or SessionStatus.Live;

    private bool RememberMethodPeaks(IEnumerable<Observation> observations, long start, long end)
    {
        var changed = false;
        foreach (var observation in observations)
        {
            if (observation.Value is not { } value || nodes[observation.NodeId].Kind != NodeKind.Method)
                continue;
            var key = (observation.NodeId, observation.Metric);
            if (methodPeaks.TryGetValue(key, out var prior))
            {
                var coveredOnly = observation.Metric == Metric.Calls && !observation.Complete;
                var priorCoveredOnly = observation.Metric == Metric.Calls && !prior.Reading.Complete;
                var previous = prior.Reading.Value!.Value;
                if (coveredOnly != priorCoveredOnly ? coveredOnly :
                    coveredOnly ? value <= previous : value / (end - start) <= previous / (prior.EndMs - prior.StartMs))
                    continue;
            }

            methodPeaks[key] = new(observation, start, end);
            changed = true;
        }
        return changed;
    }

    private bool HasValidReferences(ConnectorBatch batch, Dictionary<string, GraphNode> incoming, MetricCapability[] capabilities)
    {
        GraphNode? Find(string id) => incoming.GetValueOrDefault(id) ?? nodes.GetValueOrDefault(id);
        foreach (var node in batch.Nodes)
        {
            if (node.Id == UnresolvedId ||
                (node.ParentId is { } parent && Find(parent)?.Kind != NodeKind.Module) ||
                (nodes.TryGetValue(node.Id, out var prior) && (node.Kind != prior.Kind || node.ParentId != prior.ParentId)))
                return false;
        }

        if (batch.Relationships.Any(x => x.SourceId == UnresolvedId || x.TargetId == UnresolvedId ||
            Find(x.SourceId) is null || Find(x.TargetId) is null))
            return false;

        var declared = capabilities.ToDictionary(x => x.Metric);
        return batch.Measurements.All(x => x.NodeId != UnresolvedId && Find(x.NodeId) is { Kind: not NodeKind.Module } &&
            declared.TryGetValue(x.Metric, out var capability) &&
            (x.Quality == Quality.Unavailable || x.Quality == capability.Quality));
    }

    private bool AdmitNodes(GraphNode[] additions)
    {
        var truncated = false;
        foreach (var node in additions.Where(x => x.Kind == NodeKind.Module).Concat(additions.Where(x => x.Kind != NodeKind.Module)))
        {
            var producerNodeCount = nodes.Count - (nodes.ContainsKey(UnresolvedId) ? 1 : 0);
            if ((node.ParentId is { } parent && !nodes.ContainsKey(parent)) ||
                (!nodes.ContainsKey(node.Id) && producerNodeCount >= limits.MaxNodes - 1))
            {
                truncated = true;
                continue;
            }

            nodes[node.Id] = node;
        }

        return truncated;
    }

    private void ExpireIfSilent()
    {
        if (IsActive && snapshot is { } current &&
            (clock.GetUtcNow() - current.LastUpdate).TotalMilliseconds >= limits.InactivityMs)
            SetSnapshot(current with { Version = current.Version + 1, State = SessionStatus.Failed, EndReason = "source-timeout" });
    }

    private void SetSnapshot(MapSnapshot next)
    {
        snapshot = next;
        var prior = changed;
        changed = NewSignal();
        prior.TrySetResult();
    }

    private static string ReasonText(EndReason reason) => JsonNamingPolicy.KebabCaseLower.ConvertName(reason.ToString());
    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static byte[] Fingerprint<T>(T value) => SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, ConnectorMessages.Json));
    private static bool Matches(byte[]? old, byte[] current) => old is not null && old.AsSpan().SequenceEqual(current);
}
