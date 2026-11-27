using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeOrganism.Protocol;

public enum Metric { Cpu, Allocation, Calls }
public enum Quality { Estimated, Exact, Unavailable }
public enum NodeKind { Module, Method, Unresolved }
public enum Evidence { StackAdjacency, InstrumentedCall }
public enum LossKind { SourceEvents, SourceGap, UnresolvedAttribution, TopologyLimit }
public enum EndReason { Detached, TargetExited, ProducerError }

public sealed record ConnectorSource(string Id, string Label, string? Target = null);
public sealed record MetricCapability(Metric Metric, string Unit, string Method, Quality Quality);
public sealed record Registration(string RequestId, int Version, ConnectorSource Source, MetricCapability[] Capabilities);
public sealed record ConnectorLimits(int MaxBatchBytes, int MaxNodes, int MaxRelationships, int MinIntervalMs, int InactivityMs);
public sealed record RegisteredSession(string SessionId, ConnectorLimits Limits);
public sealed record EndSession(EndReason Reason);
public sealed record ConnectorError(string Code, string Message);

public sealed record GraphNode(string Id, NodeKind Kind, string Label, string? ParentId = null, string? Library = null);
public sealed record GraphRelationship(string SourceId, string TargetId, Evidence Evidence);
public sealed record Observation(string NodeId, Metric Metric, double? Value, Quality Quality, bool Complete);
public sealed record MeasurementLoss(LossKind Kind, Metric? Metric = null, long? Count = null);
public sealed record ConnectorBatch(
    long Sequence,
    long StartMs,
    long EndMs,
    GraphNode[] Nodes,
    GraphRelationship[] Relationships,
    Observation[] Measurements,
    MeasurementLoss[] Loss);

public static class ConnectorMessages
{
    public const int Version = 1;
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    public static JsonSerializerOptions Json { get; } = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.Strict,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.KebabCaseLower, allowIntegerValues: false) }
    };

    public static string? Validate(Registration registration)
    {
        if (registration.Version != Version)
            return "unsupported-version";

        if (!HasText(registration.RequestId) || registration.Source is not { } source ||
            !HasText(source.Id) || !HasText(source.Label) || registration.Capabilities is not { Length: > 0 })
            return "invalid-registration";

        var declared = new HashSet<Metric>();
        foreach (var capability in registration.Capabilities)
        {
            if (capability is null || !HasText(capability.Method) ||
                UnitFor(capability.Metric) is not { } unit || capability.Unit != unit ||
                capability.Quality is not (Quality.Estimated or Quality.Exact) ||
                !declared.Add(capability.Metric))
                return "invalid-capability";
        }

        return null;
    }

    public static string? Validate(ConnectorBatch batch)
    {
        if (batch.Sequence is < 1 or > MaxSafeInteger ||
            batch.StartMs < 0 || batch.EndMs <= batch.StartMs || batch.EndMs > MaxSafeInteger ||
            batch.Nodes is null || batch.Relationships is null || batch.Measurements is null || batch.Loss is null)
            return "invalid-batch";

        var nodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in batch.Nodes)
        {
            if (!IsValidNode(node) || !nodes.Add(node.Id))
                return "invalid-node";
        }

        var relationships = new HashSet<GraphRelationship>();
        foreach (var relationship in batch.Relationships)
        {
            if (relationship is null || !HasText(relationship.SourceId) || !HasText(relationship.TargetId) ||
                !Enum.IsDefined(relationship.Evidence) || !relationships.Add(relationship))
                return "invalid-relationship";
        }

        var observations = new HashSet<(string NodeId, Metric Metric)>();
        foreach (var observation in batch.Measurements)
        {
            if (!IsValidObservation(observation))
                return "invalid-measurement";

            if (!observations.Add((observation.NodeId, observation.Metric)))
                return "duplicate-measurement";
        }

        foreach (var loss in batch.Loss)
        {
            if (loss is null || !Enum.IsDefined(loss.Kind) ||
                (loss.Metric is { } metric && !Enum.IsDefined(metric)) ||
                loss.Count is < 0 or > MaxSafeInteger)
                return "invalid-loss";
        }

        return null;
    }

    private static string? UnitFor(Metric metric) => metric switch
    {
        Metric.Cpu => "ms",
        Metric.Allocation => "byte",
        Metric.Calls => "count",
        _ => null
    };

    private static bool IsValidNode([NotNullWhen(true)] GraphNode? node)
    {
        if (node is null || !HasText(node.Id) || !HasText(node.Label) || node.Id == node.ParentId)
            return false;

        return node.Kind switch
        {
            NodeKind.Module => node.ParentId is null,
            NodeKind.Method => HasText(node.ParentId),
            NodeKind.Unresolved => node.ParentId is null || HasText(node.ParentId),
            _ => false
        };
    }

    private static bool IsValidObservation([NotNullWhen(true)] Observation? observation)
    {
        if (observation is null || !HasText(observation.NodeId) || !Enum.IsDefined(observation.Metric))
            return false;

        if (observation.Quality == Quality.Unavailable)
            return observation.Value is null && !observation.Complete;

        if (observation.Quality is not (Quality.Estimated or Quality.Exact) ||
            observation.Value is not { } value || !double.IsFinite(value) ||
            value < 0 || (value == 0 && !observation.Complete))
            return false;

        return observation.Metric != Metric.Calls || (value == Math.Truncate(value) && value <= MaxSafeInteger);
    }

    private static bool HasText(string? value) => !string.IsNullOrWhiteSpace(value);
}
