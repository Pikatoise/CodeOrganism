using System.Diagnostics.Tracing;
using System.Text;
using System.Text.Json;
using CodeOrganism.CallProbes;
using Microsoft.Diagnostics.NETCore.Client;
using Microsoft.Diagnostics.Tracing;

namespace CodeOrganism.Connector.DotNet;

public static class CallCollector
{
    public const string MeasurementMethod = "dotnet-eventpipe-entry-checkpoints";
    internal static readonly EventPipeProvider Provider = new(EntryCounters.ProviderName, EventLevel.Informational);
    private static readonly Guid ProviderId = new(EntryCounters.ProviderGuid);

    internal static void Read(TraceEvent entry, Action<EntryCounters.Checkpoint> accept)
    {
        // TraceLog forwards custom events by GUID and ID without the dynamic EventPipe payload template.
        if (entry.ProviderGuid != ProviderId || (int)entry.ID != EntryCounters.CheckpointEventId || entry.EventDataLength is < 4 or > 48_000 ||
            entry.EventDataLength % 2 != 0)
            return;

        var bytes = entry.EventData();
        if (bytes[^1] != 0 || bytes[^2] != 0) return;
        var payload = Encoding.Unicode.GetString(bytes, 0, bytes.Length - 2);

        EntryCounters.Checkpoint? checkpoint;
        try { checkpoint = JsonSerializer.Deserialize<EntryCounters.Checkpoint>(payload); }
        catch (JsonException) { return; }

        if (checkpoint is { Entries.Length: > 0 and <= EntryCounters.MaxMethods, Sequence: > 0, TimestampMs: > 0 } &&
            Guid.TryParseExact(checkpoint.SourceId, "N", out _) &&
            checkpoint.Entries.All(x => x is { MethodId: not 0, Count: >= 0, ModuleName.Length: > 0 and <= 96,
                MethodName.Length: > 0 and <= 96 } && !string.IsNullOrWhiteSpace(x.ModuleName) &&
                !string.IsNullOrWhiteSpace(x.MethodName) && x.ModuleId != Guid.Empty) &&
            checkpoint.Entries.Select(x => x.MethodId).Distinct().Count() == checkpoint.Entries.Length)
            accept(checkpoint);
    }

    internal static IEnumerable<EntryCounters.CheckpointEntry> Deltas(EntryCounters.Checkpoint? baseline,
        EntryCounters.Checkpoint? current)
    {
        if (baseline is null || current is null) yield break;

        var previous = baseline.Entries.ToDictionary(x => x.MethodId);
        foreach (var entry in current.Entries)
        {
            if (!previous.TryGetValue(entry.MethodId, out var before) || entry.ModuleId != before.ModuleId ||
                entry.MethodName != before.MethodName || entry.Count < before.Count)
                continue;

            var delta = entry.Count - before.Count;
            if (delta <= ConnectorMaxCount) yield return entry with { Count = delta };
        }
    }

    private const long ConnectorMaxCount = 9_007_199_254_740_991;
}
