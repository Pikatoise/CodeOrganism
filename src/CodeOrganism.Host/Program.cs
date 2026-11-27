using System.Net;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

var app = builder.Build();
app.MapGet("/health", () => Results.Ok());
app.Run();
