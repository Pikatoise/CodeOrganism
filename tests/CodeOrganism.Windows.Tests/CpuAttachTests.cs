using System.Diagnostics;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text.Json;
using CodeOrganism.Connector.DotNet;
using CodeOrganism.Workload;

namespace CodeOrganism.Windows.Tests;

public class CpuAttachTests
{
    [Fact]
    public void RejectsAReusedProcessIdentityBeforeOpeningEtw()
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess)
            return;

        using var process = Process.GetCurrentProcess();
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        Assert.Throws<InvalidOperationException>(() =>
            CpuCollector.Capture(process.Id, process.StartTime.ToUniversalTime().AddSeconds(-10), _ => { }, stop.Token));
    }

    [ElevatedWindowsFact]
    public async Task ResolvesWarmMethodsAndSamplesBusyWorkRatherThanWaiting()
    {
        var assembly = typeof(CpuScenario).Assembly.Location;
        var runtime = Path.Combine(AppContext.BaseDirectory, "CodeOrganism.Windows.Tests.runtimeconfig.json");
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true
        };
        foreach (var argument in new[] { "exec", "--runtimeconfig", runtime, assembly })
            start.ArgumentList.Add(argument);

        using var fixture = Process.Start(start)!;
        try
        {
            using var output = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            Assert.NotNull(await fixture.StandardOutput.ReadLineAsync(output.Token));
            Assert.Contains("BusyAlpha", await fixture.StandardOutput.ReadLineAsync(output.Token));
            Assert.Contains("BusyBeta", await fixture.StandardOutput.ReadLineAsync(output.Token));

            var counts = new Dictionary<string, int>();
            var maxDispatchMs = 0L;
            using var capture = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var result = CpuCollector.Capture(fixture.Id, fixture.StartTime.ToUniversalTime(), sample =>
            {
                var name = sample.Method?.Name ?? "Unresolved";
                counts[name] = counts.GetValueOrDefault(name) + 1;
                maxDispatchMs = Math.Max(maxDispatchMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - sample.TimestampMs);
            }, capture.Token);

            Assert.True(counts.GetValueOrDefault("BusyAlpha") > 100);
            Assert.True(counts.GetValueOrDefault("BusyBeta") > 100);
            Assert.DoesNotContain("WaitForSignal", counts.Keys);
            Assert.True(result.StackWalks > 100);
            Assert.False(result.TargetExited);
            Assert.InRange(maxDispatchMs, 0, 5_000);
        }
        finally
        {
            if (!fixture.HasExited)
                fixture.Kill();
            await fixture.WaitForExitAsync();
        }
    }
}

public sealed class ElevatedWindowsFactAttribute : FactAttribute
{
    public ElevatedWindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess || !IsElevated())
            Skip = "Requires elevated 64-bit Windows for ETW CPU sampling.";
    }

    [SupportedOSPlatform("windows")]
    private static bool IsElevated()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }
}
