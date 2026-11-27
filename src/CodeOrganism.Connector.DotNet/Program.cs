using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using CodeOrganism.Connector.DotNet;

if (args is not ["probe-cpu", var pidText, var secondsText] ||
    !int.TryParse(pidText, out var pid) || pid <= 0 ||
    !int.TryParse(secondsText, out var seconds) || seconds is < 1 or > 30)
{
    Console.Error.WriteLine("Usage: CodeOrganism.Connector.DotNet probe-cpu <pid> <seconds from 1 to 30>");
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
