using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text.Json;
using CodeOrganism.Protocol;
using Microsoft.Diagnostics.NETCore.Client;
using Microsoft.Win32.SafeHandles;

namespace CodeOrganism.Connector.DotNet;

[SupportedOSPlatform("windows")]
public static class AttachSession
{
    public static ProcessTarget[] Discover()
    {
        var targets = new List<ProcessTarget>();
        foreach (var pid in DiagnosticsClient.GetPublishedProcesses())
        {
            if (pid == Environment.ProcessId)
                continue;

            try
            {
                using var process = OpenTarget(new(pid));
                targets.Add(new(pid, process.ProcessName, process.StartTime.ToUniversalTime()));
            }
            catch (AttachException) { }
        }

        return [.. targets.OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Pid)];
    }

    public static Process OpenTarget(AttachTarget target)
    {
        Process? process = null;
        try
        {
            process = Process.GetProcessById(target.Pid);
            if (target.StartedUtc is { } expected && process.StartTime.ToUniversalTime() != expected)
                throw new AttachException("target-exited", "The selected process is no longer running.");

            if (!IsWow64Process2(process.SafeHandle, out var processMachine, out var nativeMachine))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var coreClr = process.Modules.Cast<ProcessModule>().FirstOrDefault(module =>
                string.Equals(module.ModuleName, "coreclr.dll", StringComparison.OrdinalIgnoreCase));
            if ((processMachine == 0 ? nativeMachine : processMachine) != 0x8664 ||
                coreClr is null || coreClr.FileVersionInfo.ProductMajorPart != 10)
                throw new AttachException("unsupported-target", "Choose a Windows x64 process running .NET 10.");
            if (!DiagnosticsClient.GetPublishedProcesses().Contains(target.Pid))
                throw new AttachException("diagnostics-disabled", "Enable .NET diagnostics for this process and restart it.");

            var verified = process;
            process = null;
            return verified;
        }
        catch (ArgumentException)
        {
            throw new AttachException("target-exited", "The selected process is no longer running.");
        }
        catch (Win32Exception error) when (error.NativeErrorCode is 5 or 299)
        {
            throw new AttachException("access-denied", "The connector cannot inspect this process with the current Windows account.");
        }
        catch (InvalidOperationException)
        {
            throw new AttachException("target-exited", "The selected process is no longer running.");
        }
        finally
        {
            process?.Dispose();
        }
    }

    public static async Task<int> SuperviseAsync()
    {
        using var stop = new CancellationTokenSource();
        var status = new LocalAttachStatus("failed", "The connector stopped unexpectedly.");
        try
        {
            var line = await Console.In.ReadLineAsync();
            var request = line is null ? null : JsonSerializer.Deserialize<LocalAttachRequest>(line, ConnectorMessages.Json);
            if (request is null)
                return 2;

            _ = StopOnInputAsync(stop);
            using var target = OpenTarget(request.Target);
            using var client = new ConnectorClient(new Uri(request.Origin), request.ProducerToken);
            WriteStatus(new("connecting", Pid: target.Id));
            var started = target.StartTime.ToUniversalTime();
            var result = await ObservationPublisher.RunAsync(client, target.Id, started, stop.Token,
                (cadence, publish, active) => EtwWorker.CollectAsync(target.Id, started, cadence, publish, active));
            status = result.TargetExited
                ? new("exited", "The selected process exited.", target.Id)
                : new("detached", "Collection stopped. The target was left running.", target.Id);
        }
        catch (AttachException error)
        {
            status = new(error.Code switch
            {
                "target-exited" => "exited",
                "unsupported-target" => "unsupported",
                "diagnostics-disabled" or "access-denied" or "elevation-denied" => "restricted",
                _ => "failed"
            }, error.Message);
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
            status = new("detached", "Collection stopped. The target was left running.");
        }
        catch (Exception error) when (error is IOException or Win32Exception or InvalidOperationException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            status = new("failed", "The connector could not start or maintain CPU collection.");
            Console.Error.WriteLine(error.GetType().Name);
        }

        WriteStatus(status);
        return status.State is "detached" or "exited" ? 0 : 1;
    }

    private static async Task StopOnInputAsync(CancellationTokenSource stop)
    {
        try
        {
            // The only subsequent command is stop. EOF also means the supervisor exited.
            await Task.Run(Console.ReadLine).ConfigureAwait(false);
            stop.Cancel();
        }
        catch (ObjectDisposedException) { }
        catch (IOException) { stop.Cancel(); }
    }

    internal static void WriteStatus(LocalAttachStatus value) =>
        Console.WriteLine(JsonSerializer.Serialize(value, ConnectorMessages.Json));

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWow64Process2(SafeProcessHandle process, out ushort processMachine, out ushort nativeMachine);
}

internal sealed class AttachException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
