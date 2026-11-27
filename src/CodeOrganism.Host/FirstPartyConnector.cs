using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CodeOrganism.Protocol;

namespace CodeOrganism.Host;

internal sealed class FirstPartyConnector(string? executable, string producerToken, SessionStore store)
{
    private readonly object gate = new();
    private LocalAttachStatus status = new("idle");
    private CancellationTokenSource? active;

    public LocalAttachStatus Status
    {
        get
        {
            lock (gate)
            {
                if (status.State == "connecting" && active is not null &&
                    store.Read().Snapshot is { State: SessionStatus.Live, Source.Target: { } target } &&
                    target == $"PID {status.Pid}")
                    return status with { State = "connected" };

                return status;
            }
        }
    }

    public async Task<ProcessTarget[]> DiscoverAsync(CancellationToken stop)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(6));
        using var process = StartProcess("list-targets");
        try
        {
            var output = await process.StandardOutput.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            if (process.ExitCode != 0)
                throw new InvalidOperationException("Process discovery is unavailable.");

            return JsonSerializer.Deserialize<ProcessTarget[]>(output, ConnectorMessages.Json) ?? [];
        }
        finally
        {
            if (!process.HasExited)
                process.Kill();
        }
    }

    public bool Attach(AttachTarget target, string origin)
    {
        lock (gate)
        {
            if (active is not null || store.Read().Snapshot?.State is SessionStatus.Live or SessionStatus.Connecting)
                return false;

            status = new("connecting", Pid: target.Pid);
            var run = new CancellationTokenSource();
            active = run;
            _ = Task.Run(() => SuperviseAsync(new(target, origin, producerToken), run));
            return true;
        }
    }

    public void Detach()
    {
        lock (gate)
        {
            if (active is { } run)
            {
                status = status with { State = "detaching" };
                run.Cancel();
            }
            else if (store.Read().Snapshot is { State: SessionStatus.Live or SessionStatus.Connecting } external)
            {
                store.End(external.SessionId, new(EndReason.Detached));
                status = new("detached", "Collection stopped.");
            }
        }
    }

    private async Task SuperviseAsync(LocalAttachRequest request, CancellationTokenSource run)
    {
        var final = new LocalAttachStatus("failed", "The connector stopped unexpectedly.", request.Target.Pid);
        try
        {
            using var process = StartProcess("attach-stdio");
            try
            {
                await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request, ConnectorMessages.Json));
                await process.StandardInput.FlushAsync();
                using var cancel = run.Token.Register(process.StandardInput.Close);
                while (await process.StandardOutput.ReadLineAsync(run.Token) is { } line)
                {
                    var report = JsonSerializer.Deserialize<LocalAttachStatus>(line, ConnectorMessages.Json);
                    if (report is not null && report.State != "connecting")
                        final = report with { Pid = request.Target.Pid };
                }
                await process.WaitForExitAsync(run.Token);
            }
            finally
            {
                if (!process.HasExited)
                {
                    process.StandardInput.Close();
                    try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
                    catch (TimeoutException) { process.Kill(); }
                }
            }
        }
        catch (OperationCanceledException) when (run.IsCancellationRequested)
        {
            final = new("detached", "Collection stopped. The target was left running.", request.Target.Pid);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or Win32Exception or JsonException)
        {
            final = run.IsCancellationRequested
                ? new("detached", "Collection stopped. The target was left running.", request.Target.Pid)
                : new("failed", executable is null ? "Build or install the .NET connector before attaching." :
                    "The .NET connector could not start.", request.Target.Pid);
        }
        finally
        {
            lock (gate)
            {
                if (run.IsCancellationRequested)
                {
                    if (store.Read().Snapshot is { State: SessionStatus.Live or SessionStatus.Connecting, Source.Target: { } target } pending &&
                        target == $"PID {request.Target.Pid}")
                        store.End(pending.SessionId, new(EndReason.Detached));
                    final = new("detached", "Collection stopped. The target was left running.", request.Target.Pid);
                }

                status = final;
                active = null;
                run.Dispose();
            }
        }
    }

    private Process StartProcess(string command)
    {
        if (executable is null || !OperatingSystem.IsWindows())
            throw new InvalidOperationException("The Windows .NET connector is unavailable.");

        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true
        };
        start.Environment.Remove("CODEORGANISM_PRODUCER_TOKEN");
        start.ArgumentList.Add(command);
        return Process.Start(start) ?? throw new InvalidOperationException("The connector could not start.");
    }

    public static string? FindExecutable(IWebHostEnvironment environment)
    {
        const string name = "CodeOrganism.Connector.DotNet.exe";
        const string developmentPath = "src/CodeOrganism.Connector.DotNet/bin";
#if DEBUG
        const string configuration = "Debug";
#else
        const string configuration = "Release";
#endif
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("CODEORGANISM_CONNECTOR"),
            Path.Combine(AppContext.BaseDirectory, name),
            Path.Combine(environment.ContentRootPath, developmentPath, configuration, "net10.0", name),
            Path.Combine(environment.ContentRootPath, "..", "..", developmentPath, configuration, "net10.0", name)
        };
        return candidates.FirstOrDefault(path => path is not null && File.Exists(path));
    }
}

internal sealed class LocalViewControl(FirstPartyConnector connector)
{
    private const string CookieName = "CodeOrganism.View";
    private readonly string session = NewSecret();
    private readonly string csrf = NewSecret();

    public void Map(WebApplication app)
    {
        var view = app.MapGroup("/api/view/v1");
        view.MapGet("/control", (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Cookies.Append(CookieName, session, new CookieOptions
            {
                HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/api/view/v1", IsEssential = true
            });
            return Results.Json(new { csrf, status = connector.Status }, ConnectorMessages.Json);
        });

        view.MapGet("/processes", async (HttpContext context) =>
        {
            if (!IsView(context))
                return Results.StatusCode(403);

            try { return Results.Json(await connector.DiscoverAsync(context.RequestAborted), ConnectorMessages.Json); }
            catch (Exception error) when (error is IOException or Win32Exception or InvalidOperationException or JsonException or OperationCanceledException)
            {
                return Error(503, "discovery-unavailable", "The Windows .NET connector could not list processes.");
            }
        });

        view.MapPost("/attach", (HttpContext context, AttachTarget target) =>
        {
            if (!IsMutationAllowed(context))
                return Results.StatusCode(403);
            if (target.Pid <= 0)
                return Error(400, "invalid-pid", "Enter a positive process ID.");
            if (!connector.Attach(target, Origin(context)))
                return Error(409, "session-in-use", "Detach the active session before attaching another process.");
            return Results.Accepted();
        });

        view.MapPost("/detach", (Delegate)((HttpContext context) =>
        {
            if (!IsMutationAllowed(context))
                return Results.StatusCode(403);
            connector.Detach();
            return Results.Accepted();
        }));
    }

    private bool IsView(HttpContext context) => Matches(session, context.Request.Cookies[CookieName]);

    private bool IsMutationAllowed(HttpContext context) => IsView(context) &&
        context.Request.Headers.Origin == Origin(context) && Matches(csrf, context.Request.Headers["X-CodeOrganism-CSRF"]);

    private static string Origin(HttpContext context) => $"http://127.0.0.1:{context.Connection.LocalPort}";
    private static string NewSecret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private static bool Matches(string secret, string? candidate) => candidate is not null &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(candidate));
    private static IResult Error(int status, string code, string message) =>
        Results.Json(new ConnectorError(code, message), ConnectorMessages.Json, statusCode: status);
}
