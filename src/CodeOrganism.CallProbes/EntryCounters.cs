using System.Diagnostics.Tracing;
using System.Reflection;
using System.Text.Json;

namespace CodeOrganism.CallProbes;

public sealed class EntryCounters : IAsyncDisposable
{
    public const string ProviderName = "CodeOrganism-CallProbes";
    public const string ProviderGuid = "7521be90-ee75-5c0b-5393-25f1d58de01d";
    public const int CheckpointEventId = 1;
    public const int CheckpointIntervalMs = 250;
    public const int MaxMethods = 32;

    private const int StripeCount = 64;
    private readonly object gate = new();
    private readonly long[][] stripes = Enumerable.Range(0, StripeCount).Select(_ => new long[MaxMethods]).ToArray();
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

            var counter = new Counter(stripes, methods.Count, method);
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
                    checkpoint = TakeCheckpoint();
                }

                ProbeEvents.Log.Checkpoint(JsonSerializer.Serialize(checkpoint));
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
    }

    private Checkpoint TakeCheckpoint()
    {
        var locked = 0;
        try
        {
            // Hold every stripe briefly so all methods share one checkpoint boundary.
            foreach (var stripe in stripes)
            {
                Monitor.Enter(stripe);
                locked++;
            }

            return new(sourceId, ++sequence, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                [.. methods.Values.Select(counter => counter.Snapshot())]);
        }
        finally
        {
            while (locked > 0) Monitor.Exit(stripes[--locked]);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        await publisher;
        stop.Dispose();
    }

    public sealed class Counter
    {
        private readonly long[][] stripes;
        private readonly int slot;
        // Keep the method alive while using its runtime handle as an identity.
        private readonly MethodInfo method;
        private readonly CheckpointEntry identity;

        internal Counter(long[][] stripes, int slot, MethodInfo method)
        {
            this.stripes = stripes;
            this.slot = slot;
            this.method = method;
            identity = new(method.MethodHandle.Value.ToInt64(), method.Module.ModuleVersionId,
                Short(Path.GetFileNameWithoutExtension(method.Module.Name)), Short(method.Name), 0);
        }

        public void Enter()
        {
            var stripe = stripes[Environment.CurrentManagedThreadId & (StripeCount - 1)];
            lock (stripe) stripe[slot]++;
        }

        internal CheckpointEntry Snapshot()
        {
            long count = 0;
            foreach (var stripe in stripes) count += stripe[slot];
            return identity with { MethodId = method.MethodHandle.Value.ToInt64(), Count = count };
        }

        private static string Short(string name) => name.Length <= 48 ? name : name[..48];
    }

    public sealed record Checkpoint(string SourceId, long Sequence, long TimestampMs, CheckpointEntry[] Entries);
    public sealed record CheckpointEntry(long MethodId, Guid ModuleId, string ModuleName, string MethodName, long Count);

    [EventSource(Name = ProviderName, Guid = ProviderGuid)]
    private sealed class ProbeEvents : EventSource
    {
        public static readonly ProbeEvents Log = new();

        [Event(CheckpointEventId, Level = EventLevel.Informational)]
        public void Checkpoint(string payload) => WriteEvent(CheckpointEventId, payload);
    }
}
