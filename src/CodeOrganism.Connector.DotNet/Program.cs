using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using CodeOrganism.Connector.DotNet;
using CodeOrganism.Protocol;

if (args is ["list-targets"])
{
    if (!OperatingSystem.IsWindows())
        return 2;
    Console.WriteLine(JsonSerializer.Serialize(AttachSession.Discover(), ConnectorMessages.Json));
    return 0;
}

if (args is ["attach-stdio"])
    return OperatingSystem.IsWindows() ? await AttachSession.SuperviseAsync() : 2;

if (args is ["etw-worker", var pipe, var nonce, var pidArg, var ticksArg, var cadenceArg, var supervisorArg] &&
    int.TryParse(pidArg, out var workerPid) && long.TryParse(ticksArg, out var workerTicks) &&
    workerTicks > 0 && workerTicks <= DateTime.MaxValue.Ticks &&
    int.TryParse(cadenceArg, out var workerCadence) && int.TryParse(supervisorArg, out var supervisorPid))
    return OperatingSystem.IsWindows()
        ? await EtwWorker.RunAsync(pipe, nonce, workerPid, new DateTime(workerTicks, DateTimeKind.Utc), workerCadence, supervisorPid)
        : 2;

if (args is ["publish-cpu", var targetText, var originText, var durationText] &&
    int.TryParse(targetText, out var targetPid) && targetPid > 0 &&
    Uri.TryCreate(originText, UriKind.Absolute, out var origin) &&
    int.TryParse(durationText, out var duration) && duration is >= 3 and <= 120)
{
    // Read the ephemeral credential from the supervisor's pipe.
    var token = await Console.In.ReadLineAsync();
    try
    {
        using var target = Process.GetProcessById(targetPid);
        using var client = new ConnectorClient(origin, token ?? "");
        using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(duration));
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; lifetime.Cancel(); };
        var result = await ObservationPublisher.RunAsync(client, targetPid, target.StartTime.ToUniversalTime(), lifetime.Token);
        Console.WriteLine(JsonSerializer.Serialize(result, JsonSerializerOptions.Web));
        return 0;
    }
    catch (Exception error) when (error is UnauthorizedAccessException or Win32Exception or InvalidOperationException or ArgumentException)
    {
        Console.Error.WriteLine($"CPU publish failed: {error.Message}");
        return 1;
    }
    catch (OperationCanceledException)
    {
        return 0;
    }
}

if (args is not ["probe-cpu", var pidText, var secondsText] ||
    !int.TryParse(pidText, out var pid) || pid <= 0 ||
    !int.TryParse(secondsText, out var seconds) || seconds is < 1 or > 30)
{
    Console.Error.WriteLine("Usage: CodeOrganism.Connector.DotNet probe-cpu <pid> <seconds from 1 to 30>");
    Console.Error.WriteLine("   or: CodeOrganism.Connector.DotNet publish-cpu <pid> <loopback-origin> <seconds from 3 to 120>");
    return 2;
}

try
{
    using var target = Process.GetProcessById(pid);
    using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
    var methods = new Dictionary<string, double>();
    var maxDispatchMs = 0L;
    var result = CpuCollector.Capture(pid, target.StartTime.ToUniversalTime(), sample =>
    {
        var name = sample.Method is { } method ? $"{method.TypeName}.{method.Name}" : "(unresolved)";
        methods[name] = methods.GetValueOrDefault(name) + sample.CpuMilliseconds;
        var dispatchMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - sample.TimestampMs;
        maxDispatchMs = Math.Max(dispatchMs, maxDispatchMs);
    }, stop.Token);

    Console.WriteLine(JsonSerializer.Serialize(new { result, maxDispatchMs, methods }, JsonSerializerOptions.Web));
    return 0;
}
catch (Exception error) when (error is UnauthorizedAccessException or Win32Exception or InvalidOperationException or ArgumentException)
{
    Console.Error.WriteLine($"CPU probe failed: {error.Message}");
    return 1;
}
