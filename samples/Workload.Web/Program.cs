using System.Net;
using CodeOrganism.Workload;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

var app = builder.Build();
CpuPhase? latest = null;
app.MapGet("/cpu-phase", () => Volatile.Read(ref latest));

await app.StartAsync();
var workload = CpuScenario.RunAsync(TimeSpan.FromSeconds(3), phase => Volatile.Write(ref latest, phase),
    app.Lifetime.ApplicationStopping);
await app.WaitForShutdownAsync();
await workload;
