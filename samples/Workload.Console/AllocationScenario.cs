using System.Diagnostics;
using System.Runtime.CompilerServices;

namespace CodeOrganism.Workload;

public sealed record AllocationPhase(string Method, bool Heavy, long TimestampMs, double DurationMs, long Bytes);

public static class AllocationScenario
{
    private static byte[]? latest;
    public static void Run(Action<AllocationPhase> report, CancellationToken stop)
    {
        var phase = 0;
        while (!stop.IsCancellationRequested)
        {
            var alphaHeavy = phase++ % 2 == 0;
            var limit = Stopwatch.GetTimestamp() + 3 * Stopwatch.Frequency;
            while (!stop.IsCancellationRequested && Stopwatch.GetTimestamp() < limit)
            {
                Measure(nameof(AllocateOrders), alphaHeavy, AllocateOrders, report);
                Measure(nameof(AllocateInvoices), !alphaHeavy, AllocateInvoices, report);
                stop.WaitHandle.WaitOne(30);
            }
        }
    }

    private static void Measure(string method, bool heavy, Action<int> allocate, Action<AllocationPhase> report)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var start = Stopwatch.GetTimestamp();
        var before = GC.GetAllocatedBytesForCurrentThread();
        allocate(heavy ? 128 : 4);
        var bytes = GC.GetAllocatedBytesForCurrentThread() - before;
        report(new(method, heavy, timestamp, Stopwatch.GetElapsedTime(start).TotalMilliseconds, bytes));
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void AllocateOrders(int count)
    {
        for (var i = 0; i < count; i++) Volatile.Write(ref latest, new byte[8_192]);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void AllocateInvoices(int count)
    {
        for (var i = 0; i < count; i++) Volatile.Write(ref latest, new byte[8_192]);
    }
}
