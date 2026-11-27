using System.Net;
using CodeOrganism.Host;
using CodeOrganism.Protocol;
using Microsoft.Extensions.FileProviders;

var grantExternal = args.Contains(ConnectorAuthorization.GrantOption, StringComparer.Ordinal);
var builder = WebApplication.CreateBuilder(args.Where(arg => arg != ConnectorAuthorization.GrantOption).ToArray());
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

var limits = new ConnectorLimits(256 * 1024, 2_000, 6_000, 100, 10_000);
var credential = new ConnectorAuthorization(grantExternal,
    Environment.GetEnvironmentVariable(ConnectorAuthorization.TokenEnvironmentVariable));
if (credential.GeneratedExternalToken is { } externalToken)
    Console.WriteLine($"External producer credential: {externalToken}");
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

    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
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
var supervisor = new FirstPartyConnector(FirstPartyConnector.FindExecutable(app.Environment), credential.FirstPartyToken, store);
new LocalViewControl(supervisor).Map(app);
app.Lifetime.ApplicationStopping.Register(supervisor.Detach);
app.MapGet("/api/view/v1/events", (HttpContext context) => SnapshotStream.WriteAsync(context, store));
app.Run();
