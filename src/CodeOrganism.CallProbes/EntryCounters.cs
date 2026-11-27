using System.Diagnostics.Tracing;
using System.Reflection;
using System.Text.Json;

namespace CodeOrganism.CallProbes;

public sealed class EntryCounters : IAsyncDisposable
{
    public const string ProviderName = "CodeOrganism-CallProbes";
    public const int CheckpointIntervalMs = 250;
    public const int MaxMethods = 32;

    private readonly object gate = new();
    private readonly Dictionary<RuntimeMethodHandle, Counter> methods = new();
    private readonly CancellationTokenSource stop = new();
    private readonly Task publisher;
    private readonly string sourceId = Guid.NewGuid().ToString("N");
    private long sequence;

    public EntryCounters() => publisher = PublishAsync();

    public Counter Register(MethodInfo method)
    {
        ArgumentNullException.ThrowIfNull(method);
        if (method.IsAbstract || method.IsGenericMethod || method.DeclaringType is null ||
            method.DeclaringType.IsGenericType || method.GetMethodBody() is null)
            throw new ArgumentException("Register a non-generic managed method with a body.", nameof(method));

        lock (gate)
        {
            if (methods.TryGetValue(method.MethodHandle, out var existing)) return existing;
            if (methods.Count == MaxMethods) throw new InvalidOperationException("The probe method limit was reached.");

            var counter = new Counter(gate, method);
            methods.Add(method.MethodHandle, counter);
            return counter;
        }
    }

    private async Task PublishAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(CheckpointIntervalMs));
        try
        {
            while (await timer.WaitForNextTickAsync(stop.Token))
            {
                if (!ProbeEvents.Log.IsEnabled()) continue;
                Checkpoint checkpoint;
                lock (gate)
                {
                    if (methods.Count == 0) continue;
                    checkpoint = new(sourceId, ++sequence, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        [.. methods.Values.Select(counter => counter.Snapshot())]);
                }

                ProbeEvents.Log.Checkpoint(JsonSerializer.Serialize(checkpoint));
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        await publisher;
        stop.Dispose();
    }

    public sealed class Counter
    {
        private readonly object gate;
        // Keep the method alive while using its runtime handle as an identity.
        private readonly MethodInfo method;
        private readonly CheckpointEntry identity;
        private long count;

        internal Counter(object gate, MethodInfo method)
        {
            this.gate = gate;
            this.method = method;
            identity = new(method.MethodHandle.Value.ToInt64(), method.Module.ModuleVersionId,
                Short(Path.GetFileNameWithoutExtension(method.Module.Name)), Short(method.Name), 0);
        }

        public void Enter()
        {
            lock (gate) count++;
        }

        internal CheckpointEntry Snapshot() => identity with { MethodId = method.MethodHandle.Value.ToInt64(), Count = count };

        private static string Short(string name) => name.Length <= 96 ? name : name[..96];
    }

    public sealed record Checkpoint(string SourceId, long Sequence, long TimestampMs, CheckpointEntry[] Entries);
    public sealed record CheckpointEntry(long MethodId, Guid ModuleId, string ModuleName, string MethodName, long Count);

    [EventSource(Name = ProviderName)]
    private sealed class ProbeEvents() : EventSource(EventSourceSettings.EtwSelfDescribingEventFormat)
    {
        public static readonly ProbeEvents Log = new();

        [Event(1, Level = EventLevel.Informational)]
        public void Checkpoint(string payload) => WriteEvent(1, payload);
    }
}
