using System.Diagnostics;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Parsers.Clr;
using Microsoft.Diagnostics.Tracing.Session;

namespace CodeOrganism.Connector.DotNet;

public sealed record CpuMethod(long ModuleId, long MethodId, string Name, string TypeName, string Signature);
public sealed record CpuSample(long TimestampMs, CpuMethod? Method, double CpuMilliseconds);
public sealed record CpuCaptureResult(int Samples, int StackWalks, int LostEvents, bool TargetExited, bool MetadataTruncated);

public static class CpuCollector
{
    private const int SampleIntervalMs = 1;
    private const int MethodLimit = 32_768;

    public static CpuCaptureResult Capture(int processId, DateTime expectedStartUtc, Action<CpuSample> publish, CancellationToken stop)
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess)
            throw new PlatformNotSupportedException("CPU sampling requires a 64-bit Windows process.");

        stop.ThrowIfCancellationRequested();
        using var target = Process.GetProcessById(processId);
        if (target.StartTime.ToUniversalTime() != expectedStartUtc)
            throw new InvalidOperationException("The target process ID belongs to a different process.");

        using var trace = new TraceEventSession("CodeOrganism-" + Guid.NewGuid().ToString("N"))
        {
            StopOnDispose = true,
            BufferSizeMB = 32,
            CpuSampleIntervalMSec = SampleIntervalMs
        };

        trace.EnableKernelProvider(
            KernelTraceEventParser.Keywords.Profile | KernelTraceEventParser.Keywords.Process | KernelTraceEventParser.Keywords.Thread,
            KernelTraceEventParser.Keywords.Profile);
        using var source = trace.Source;
        using var halt = CancellationTokenSource.CreateLinkedTokenSource(stop);
        target.EnableRaisingEvents = true;
        target.Exited += TargetExited;
        using var observer = halt.Token.Register(source.StopProcessing);

        try
        {
            if (target.HasExited)
                return new(0, 0, 0, true, false);

            var methods = new SortedList<ulong, CodeRange>();
            var samples = 0;
            var stackWalks = 0;
            var truncated = false;
            var runtime = source.Clr;
            runtime.MethodLoadVerbose += IndexMethod;
            runtime.MethodUnloadVerbose += data =>
            {
                var address = (ulong)data.MethodStartAddress;
                if (data.ProcessID == processId && methods.TryGetValue(address, out var range) && range.Method.MethodId == data.MethodID)
                    methods.Remove(address);
            };
            new ClrRundownTraceEventParser(source).MethodDCStartVerbose += IndexMethod;

            source.Kernel.PerfInfoSample += sample =>
            {
                if (halt.IsCancellationRequested || sample.ProcessID != processId || sample.NonProcess)
                    return;

                samples++;
                var method = FindMethod(methods, (ulong)sample.InstructionPointer);
                var timestamp = new DateTimeOffset(sample.TimeStamp).ToUnixTimeMilliseconds();
                publish(new(timestamp, method, Math.Max(1, sample.Count) * (double)SampleIntervalMs));
            };
            source.Kernel.StackWalkStack += stack =>
            {
                if (!halt.IsCancellationRequested && stack.ProcessID == processId)
                    stackWalks++;
            };

            var options = new TraceEventProviderOptions { ProcessIDFilter = [processId] };
            trace.EnableProvider(ClrTraceEventParser.ProviderGuid, TraceEventLevel.Verbose,
                (ulong)(ClrTraceEventParser.Keywords.Jit | ClrTraceEventParser.Keywords.Loader), options);
            trace.EnableProvider(ClrRundownTraceEventParser.ProviderGuid, TraceEventLevel.Verbose,
                (ulong)(ClrRundownTraceEventParser.Keywords.Jit | ClrRundownTraceEventParser.Keywords.Loader |
                    ClrRundownTraceEventParser.Keywords.StartEnumeration), options);

            if (!halt.IsCancellationRequested)
                source.Process();

            return new(samples, stackWalks, Math.Max(source.EventsLost, trace.EventsLost), target.HasExited, truncated);

            void IndexMethod(MethodLoadUnloadVerboseTraceData data)
            {
                if (halt.IsCancellationRequested || data.ProcessID != processId || data.MethodSize <= 0)
                    return;

                var address = (ulong)data.MethodStartAddress;
                if (methods.Count >= MethodLimit && !methods.ContainsKey(address))
                {
                    truncated = true;
                    return;
                }

                var method = new CpuMethod(data.ModuleID, data.MethodID, data.MethodName, data.MethodNamespace, data.MethodSignature);
                methods[address] = new(address + (ulong)data.MethodSize, method);
            }
        }
        finally
        {
            target.Exited -= TargetExited;
        }

        void TargetExited(object? sender, EventArgs args) => halt.Cancel();
    }

    private static CpuMethod? FindMethod(SortedList<ulong, CodeRange> methods, ulong address)
    {
        var left = 0;
        var right = methods.Count;
        while (left < right)
        {
            var middle = left + (right - left) / 2;
            if (methods.Keys[middle] <= address)
                left = middle + 1;
            else
                right = middle;
        }

        return left > 0 && address < methods.Values[left - 1].End ? methods.Values[left - 1].Method : null;
    }

    private sealed record CodeRange(ulong End, CpuMethod Method);
}
