using System.Diagnostics;
using System.Runtime.CompilerServices;

namespace CodeOrganism.Workload;

public sealed record CpuPhase(string Method, int Iteration, long TimestampMs, long StopwatchTicks);

public static class CpuScenario
{
    private const int WorkPerBlock = 20_000;
    private static uint sink;

    public static Task RunAsync(TimeSpan phaseLength, Action<CpuPhase> report, CancellationToken stop)
    {
        var idle = Task.Factory.StartNew(() => WaitForSignal(stop), CancellationToken.None,
            TaskCreationOptions.LongRunning, TaskScheduler.Default);
        var busy = Task.Factory.StartNew(() =>
        {
            for (var phase = 0; !stop.IsCancellationRequested; phase++)
            {
                var alpha = phase % 2 == 0;
                report(new(alpha ? nameof(BusyAlpha) : nameof(BusyBeta), phase,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Stopwatch.GetTimestamp()));
                var end = Stopwatch.GetTimestamp() + (long)(phaseLength.TotalSeconds * Stopwatch.Frequency);
                do
                {
                    sink = alpha ? BusyAlpha(sink) : BusyBeta(sink);
                } while (!stop.IsCancellationRequested && Stopwatch.GetTimestamp() < end);
            }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

        return Task.WhenAll(busy, idle);
    }

    public static TimeSpan Measure(int blocks)
    {
        for (var i = 0; i < 100; i++)
            sink = BusyBeta(BusyAlpha(sink));

        var start = Stopwatch.GetTimestamp();
        for (var i = 0; i < blocks; i++)
            sink = BusyBeta(BusyAlpha(sink));

        return Stopwatch.GetElapsedTime(start);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static uint BusyAlpha(uint state)
    {
        for (var i = 0; i < WorkPerBlock; i++)
            state = unchecked(state * 1_664_525u + 1_013_904_223u);
        return state;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static uint BusyBeta(uint state)
    {
        for (var i = 0; i < WorkPerBlock; i++)
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
        }
        return state;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void WaitForSignal(CancellationToken stop) => stop.WaitHandle.WaitOne();
}
