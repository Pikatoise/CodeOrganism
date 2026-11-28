using System.Text.Json;
using CodeOrganism.Protocol;

namespace CodeOrganism.Host;

public sealed record MethodPeak(Observation Reading, long StartMs, long EndMs);

public sealed record MapSnapshot(
    string SessionId, long Version, SessionStatus State, ConnectorSource Source, MetricCapability[] Capabilities,
    long? StartMs, long? EndMs, GraphNode[] Nodes, GraphRelationship[] Relationships, Observation[] Measurements,
    MeasurementLoss[] Loss, long Gaps, DateTimeOffset LastUpdate, string? EndReason, MethodPeak[] MethodPeaks);

public static class SnapshotStream
{
    public static Observation[] WithRollups(IEnumerable<GraphNode> nodes, List<Observation> observations, List<MeasurementLoss> loss)
    {
        var nodeIndex = nodes.ToDictionary(x => x.Id, StringComparer.Ordinal);
        var expected = nodeIndex.Values.Where(x => x.ParentId is not null)
            .ToLookup(x => x.ParentId!, StringComparer.Ordinal);
        var results = new List<Observation>(observations);
        foreach (var group in observations
            .Where(x => nodeIndex[x.NodeId].ParentId is not null)
            .GroupBy(x => (Parent: nodeIndex[x.NodeId].ParentId!, x.Metric)))
        {
            var complete = group.Count() == expected[group.Key.Parent].Count() &&
                !loss.Any(x => x.Kind is LossKind.TopologyLimit or LossKind.SourceEvents or LossKind.UnresolvedAttribution &&
                    (x.Metric is null || x.Metric == group.Key.Metric));
            results.Add(Aggregate(group.Key.Parent, group.Key.Metric, group, complete));
        }

        return [.. results];
    }

    public static Observation Aggregate(string id, Metric metric, IEnumerable<Observation> observations, bool complete)
    {
        var total = 0.0;
        var available = false;
        var quality = Quality.Exact;
        foreach (var observation in observations)
        {
            if (observation.Value is { } value)
            {
                available = true;
                total += value;
            }

            complete &= observation.Complete;
            if (observation.Quality == Quality.Estimated)
                quality = Quality.Estimated;
        }

        if (!available || !double.IsFinite(total) || (metric == Metric.Calls && total > 9_007_199_254_740_991))
            return new(id, metric, null, Quality.Unavailable, false);

        return new(id, metric, total, quality, complete);
    }

    public static async Task WriteAsync(HttpContext context, SessionStore store)
    {
        var response = context.Response;
        var stop = context.RequestAborted;
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-store";
        var previous = (Session: (string?)null, Version: 0L);

        try
        {
            await response.WriteAsync(": connected\n\n", stop);
            while (!stop.IsCancellationRequested)
            {
                var read = store.Read();
                if (read.Snapshot is { } snapshot && previous != (snapshot.SessionId, snapshot.Version))
                {
                    var json = JsonSerializer.Serialize(snapshot, ConnectorMessages.Json);
                    await response.WriteAsync($"event: snapshot\ndata: {json}\n\n", stop);
                    await response.Body.FlushAsync(stop);
                    previous = (snapshot.SessionId, snapshot.Version);
                }

                try
                {
                    await read.Changed.WaitAsync(TimeSpan.FromSeconds(2), stop);
                }
                catch (TimeoutException)
                {
                    await response.WriteAsync(": heartbeat\n\n", stop);
                    await response.Body.FlushAsync(stop);
                }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
            // The browser disconnected.
        }
    }
}
