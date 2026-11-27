using System.Net;
using System.Security.Cryptography;
using CodeOrganism.Host;
using CodeOrganism.Protocol;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

var limits = new ConnectorLimits(256 * 1024, 2_000, 6_000, 100, 10_000);
var bootstrapToken = Environment.GetEnvironmentVariable("CODEORGANISM_PRODUCER_TOKEN");
var credential = new ProducerCredential(string.IsNullOrWhiteSpace(bootstrapToken)
    ? Convert.ToHexString(RandomNumberGenerator.GetBytes(32))
    : bootstrapToken);
builder.Services.AddSingleton(new SessionStore(TimeProvider.System, limits));

var app = builder.Build();
app.Use(async (context, next) =>
{
    var request = context.Request;
    var origin = $"http://127.0.0.1:{context.Connection.LocalPort}";
    if (!string.Equals(request.Host.Value, $"127.0.0.1:{context.Connection.LocalPort}", StringComparison.Ordinal) ||
        (request.Headers.TryGetValue("Origin", out var claimedOrigin) && claimedOrigin != origin) ||
        request.Headers["Sec-Fetch-Site"] == "cross-site")
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    await next(context);
});

var configuredAssets = Environment.GetEnvironmentVariable("CODEORGANISM_WEB_ROOT");
var candidates = new[]
{
    configuredAssets,
    Path.Combine(app.Environment.ContentRootPath, "src", "web", "dist"),
    Path.Combine(app.Environment.ContentRootPath, "..", "web", "dist"),
    app.Environment.WebRootPath
};
var webAssets = candidates.FirstOrDefault(path => path is not null && File.Exists(Path.Combine(path, "index.html")));
if (webAssets is not null)
{
    var assets = new PhysicalFileProvider(Path.GetFullPath(webAssets));
    app.Lifetime.ApplicationStopped.Register(assets.Dispose);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = assets });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = assets });
}

app.MapGet("/health", () => Results.Ok());
var store = app.Services.GetRequiredService<SessionStore>();
new ConnectorEndpoints(store, limits, credential).Map(app);
app.MapGet("/api/view/v1/events", (HttpContext context) => SnapshotStream.WriteAsync(context, store));
app.Run();
