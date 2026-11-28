using System.Diagnostics;
using System.Runtime.CompilerServices;
#if CALL_PROBES
using System.Reflection;
using CodeOrganism.CallProbes;
#endif

namespace CodeOrganism.Workload;

public static class CallScenario
{
#if CALL_PROBES
    private static EntryCounters.Counter concurrent = null!;
    private static EntryCounters.Counter recursive = null!;
    private static EntryCounters.Counter throwing = null!;
#endif

    public static async Task<int> RunAsync(bool repeat)
    {
#if !CALL_PROBES
        if (repeat)
        {
            Console.Error.WriteLine("Build with -p:EnableCallProbes=true to run the repeating call workload.");
            return 2;
        }
#endif
#if CALL_PROBES
        await using var counters = new EntryCounters();
        concurrent = Register(nameof(ConcurrentEntry));
        recursive = Register(nameof(RecursiveEntry));
        throwing = Register(nameof(ThrowingEntry));

        EntryCounters.Counter Register(string name) => counters.Register(typeof(CallScenario)
            .GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!);
#endif
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { pid = Environment.ProcessId, ready = true }));
        if (repeat)
        {
            for (var phase = 0; ; phase ^= 1)
            {
                RunCalls(phase == 0 ? 4_000 : 20_000);
                await Task.Delay(1_000);
            }
        }
        while (await Console.In.ReadLineAsync() is { } command)
        {
            if (!int.TryParse(command, out var loops) || loops <= 0) break;

            var start = Stopwatch.GetTimestamp();
            RunCalls(loops);
            Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { elapsedMs = Stopwatch.GetElapsedTime(start).TotalMilliseconds }));
        }
        return 0;
    }

    private static void RunCalls(int loops)
    {
        Parallel.For(0, 4, _ =>
        {
            for (var i = 0; i < loops; i++) ConcurrentEntry(i);
        });
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void ConcurrentEntry(int iteration)
    {
#if CALL_PROBES
        concurrent.Enter();
#endif
        RecursiveEntry(2);
        if (iteration % 100 == 0)
        {
            try { ThrowingEntry(); }
            catch (InvalidOperationException) { }
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void RecursiveEntry(int depth)
    {
#if CALL_PROBES
        recursive.Enter();
#endif
        if (depth > 0) RecursiveEntry(depth - 1);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void ThrowingEntry()
    {
#if CALL_PROBES
        throwing.Enter();
#endif
        throw new InvalidOperationException("Expected workload exception.");
    }
}
