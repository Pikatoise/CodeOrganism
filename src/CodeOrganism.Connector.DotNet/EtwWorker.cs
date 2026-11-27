using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using CodeOrganism.Protocol;
using Microsoft.Win32.SafeHandles;

namespace CodeOrganism.Connector.DotNet;

[SupportedOSPlatform("windows")]
internal static class EtwWorker
{
    private sealed record WorkerFrame(ConnectorBatch? Batch = null, CpuCaptureResult? Result = null, string? Error = null);

    public static async Task<CpuCaptureResult> CollectAsync(int pid, DateTime startedUtc, int cadence,
        Func<ConnectorBatch, CancellationToken, Task> publish, CancellationToken stop)
    {
        var name = "CodeOrganism-" + Guid.NewGuid().ToString("N");
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        using var identity = WindowsIdentity.GetCurrent();
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(new PipeAccessRule(identity.User!, PipeAccessRights.FullControl,
            System.Security.AccessControl.AccessControlType.Allow));

        using var pipe = NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 0, 0, security);

        Process? worker;
        try
        {
            var launch = new ProcessStartInfo(InstalledExecutable())
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden
            };
            foreach (var value in new[] { "etw-worker", name, nonce, pid.ToString(), startedUtc.Ticks.ToString(), cadence.ToString(), Environment.ProcessId.ToString() })
                launch.ArgumentList.Add(value);
            worker = await Task.Run(() => Process.Start(launch), stop);
        }
        catch (Win32Exception error) when (error.NativeErrorCode is 5 or 1223)
        {
            throw new AttachException("elevation-denied", "Windows did not permit CPU collection. Approve the elevation prompt to attach.");
        }

        using (worker)
        {
            if (worker is null)
                throw new AttachException("worker-failed", "Windows did not start the CPU collector.");
            using var handshake = CancellationTokenSource.CreateLinkedTokenSource(stop);
            handshake.CancelAfter(TimeSpan.FromSeconds(10));
            try
            {
                await pipe.WaitForConnectionAsync(handshake.Token);
                if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var caller) || caller != worker.Id)
                    throw new AttachException("worker-failed", "The CPU collector did not authenticate.");
                using var reader = new StreamReader(pipe, leaveOpen: true);
                using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
                var proof = await reader.ReadLineAsync(handshake.Token);
                if (proof != nonce)
                    throw new AttachException("worker-failed", "The CPU collector did not authenticate.");
                await writer.WriteLineAsync("start".AsMemory(), handshake.Token);

                while (await reader.ReadLineAsync(stop) is { } line)
                {
                    var frame = JsonSerializer.Deserialize<WorkerFrame>(line, ConnectorMessages.Json);
                    if (frame?.Error is { } error)
                        throw new AttachException(error, error == "target-exited" ? "The selected process exited." :
                            "The CPU collector could not read this process.");
                    if (frame?.Result is { } result)
                        return result;
                    if (frame?.Batch is { } batch)
                        await publish(batch, stop);
                }

                throw new AttachException("worker-failed", "The CPU collector disconnected.");
            }
            catch (OperationCanceledException) when (!stop.IsCancellationRequested)
            {
                throw new AttachException("access-denied", "The collector could not open its private pipe for this Windows account.");
            }
            finally
            {
                // EOF cancels ETW in the worker even if the connector exits unexpectedly.
                await pipe.DisposeAsync();
                try { await worker.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
                catch (TimeoutException) { }
            }
        }
    }

    public static async Task<int> RunAsync(string name, string nonce, int pid, DateTime startedUtc, int cadence, int supervisorPid)
    {
        if (name.Length != 45 || !name.StartsWith("CodeOrganism-", StringComparison.Ordinal) ||
            !Guid.TryParseExact(name[13..], "N", out _) || nonce.Length != 64 || !nonce.All(char.IsAsciiHexDigit) ||
            pid <= 0 || supervisorPid <= 0 || cadence is < 100 or > 2_000)
            return 2;

        using var stop = new CancellationTokenSource();
        using var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        try { await pipe.ConnectAsync(8_000, stop.Token); }
        catch (TimeoutException) { return 1; }

        if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var server) || server != supervisorPid)
            return 1;

        using var reader = new StreamReader(pipe, leaveOpen: true);
        using var confirm = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await WriteLineAsync(nonce, confirm.Token);
        if (await reader.ReadLineAsync(confirm.Token) != "start")
            return 1;

        using var monitor = new CancellationTokenSource();
        var disconnect = StopOnDisconnectAsync();
        try
        {
            using var verified = AttachSession.OpenTarget(new(pid, startedUtc));
            var result = await ObservationPublisher.CollectBatchesAsync(pid, startedUtc, cadence,
                (batch, active) => WriteAsync(new(Batch: batch), active), stop.Token);
            if (!stop.IsCancellationRequested)
                await WriteAsync(new(Result: result), stop.Token);
            return 0;
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { return 0; }
        catch (IOException) { return 0; }
        catch (Exception error) when (error is AttachException or Win32Exception or UnauthorizedAccessException or InvalidOperationException)
        {
            if (!stop.IsCancellationRequested)
                await WriteAsync(new(Error: error is AttachException known ? known.Code : "access-denied"), stop.Token);
            return 1;
        }
        finally
        {
            monitor.Cancel();
            await disconnect;
        }

        Task WriteAsync(WorkerFrame frame, CancellationToken active) =>
            WriteLineAsync(JsonSerializer.Serialize(frame, ConnectorMessages.Json), active);

        Task WriteLineAsync(string line, CancellationToken active) =>
            pipe.WriteAsync(Encoding.UTF8.GetBytes(line + "\n"), active).AsTask();

        async Task StopOnDisconnectAsync()
        {
            try { await reader.ReadLineAsync(monitor.Token); }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
            catch (OperationCanceledException) when (monitor.IsCancellationRequested) { return; }
            stop.Cancel();
        }
    }

    private static string InstalledExecutable() => Path.Combine(AppContext.BaseDirectory, "CodeOrganism.Connector.DotNet.exe");

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
}
