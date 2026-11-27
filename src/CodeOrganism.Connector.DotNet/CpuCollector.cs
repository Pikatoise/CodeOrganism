using System.Diagnostics;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Parsers.Clr;
using Microsoft.Diagnostics.Tracing.Session;

namespace CodeOrganism.Connector.DotNet;

public sealed record CpuMethod(long ModuleId, long MethodId, string Name, string TypeName, string Signature,
    string? ModuleName = null, string? Library = null);
public sealed record CpuSample(long TimestampMs, CpuMethod? Method, double CpuMilliseconds);
public sealed record CpuStack(long TimestampMs, CpuMethod?[] Frames);
public sealed record CpuCaptureResult(int Samples, int StackWalks, int LostEvents, bool TargetExited, bool MetadataTruncated);

public static class CpuCollector
{
    private const int SampleIntervalMs = 1;
    public static CpuCaptureResult Capture(int processId, DateTime expectedStartUtc, Action<CpuSample> publish,
        CancellationToken stop, Action<CpuStack>? publishStack = null, ManagedCodeIndex? code = null)
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

            var index = code ?? new ManagedCodeIndex();
            var samples = 0;
            var stackWalks = 0;
            var runtime = source.Clr;
            runtime.LoaderModuleLoad += IndexModule;
            runtime.MethodLoadVerbose += IndexMethod;
            runtime.MethodUnloadVerbose += data =>
            {
                if (data.ProcessID == processId)
                    index.RemoveMethod((ulong)data.MethodStartAddress, data.MethodID);
            };
            var rundown = new ClrRundownTraceEventParser(source);
            rundown.LoaderModuleDCStart += IndexModule;
            rundown.MethodDCStartVerbose += IndexMethod;

            source.Kernel.PerfInfoSample += sample =>
            {
                if (halt.IsCancellationRequested || sample.ProcessID != processId || sample.NonProcess)
                    return;

                samples++;
                var method = index.Resolve((ulong)sample.InstructionPointer);
                var timestamp = new DateTimeOffset(sample.TimeStamp).ToUnixTimeMilliseconds();
                publish(new(timestamp, method, Math.Max(1, sample.Count) * (double)SampleIntervalMs));
            };
            source.Kernel.StackWalkStack += stack =>
            {
                if (halt.IsCancellationRequested || stack.ProcessID != processId)
                    return;

                stackWalks++;
                if (publishStack is null || stack.FrameCount < 2)
                    return;

                var frames = new CpuMethod?[stack.FrameCount];
                for (var i = 0; i < frames.Length; i++)
                    frames[i] = index.Resolve((ulong)stack.InstructionPointer(i));

                // Only the kernel profile event requests stack walks in this session.
                var timestamp = new DateTimeOffset(stack.TimeStamp).ToUnixTimeMilliseconds();
                publishStack(new(timestamp, frames));
            };

            var options = new TraceEventProviderOptions { ProcessIDFilter = [processId] };
            trace.EnableProvider(ClrTraceEventParser.ProviderGuid, TraceEventLevel.Verbose,
                (ulong)(ClrTraceEventParser.Keywords.Jit | ClrTraceEventParser.Keywords.Loader), options);
            trace.EnableProvider(ClrRundownTraceEventParser.ProviderGuid, TraceEventLevel.Verbose,
                (ulong)(ClrRundownTraceEventParser.Keywords.Jit | ClrRundownTraceEventParser.Keywords.Loader |
                    ClrRundownTraceEventParser.Keywords.StartEnumeration), options);

            if (!halt.IsCancellationRequested)
                source.Process();

            return new(samples, stackWalks, Math.Max(source.EventsLost, trace.EventsLost), target.HasExited, index.Truncated);

            void IndexModule(ModuleLoadUnloadTraceData data)
            {
                if (data.ProcessID == processId)
                    index.AddModule(data.ModuleID, data.ModuleILPath);
            }

            void IndexMethod(MethodLoadUnloadVerboseTraceData data)
            {
                if (halt.IsCancellationRequested || data.ProcessID != processId || data.MethodSize <= 0)
                    return;

                index.AddMethod((ulong)data.MethodStartAddress, data.MethodSize,
                    new(data.ModuleID, data.MethodID, data.MethodName, data.MethodNamespace, data.MethodSignature));
            }
        }
        finally
        {
            target.Exited -= TargetExited;
        }

        void TargetExited(object? sender, EventArgs args) => halt.Cancel();
    }

}
