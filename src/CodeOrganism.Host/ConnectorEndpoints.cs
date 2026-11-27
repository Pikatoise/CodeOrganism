using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CodeOrganism.Protocol;
using Microsoft.AspNetCore.Http.Features;

namespace CodeOrganism.Host;

internal sealed class ConnectorEndpoints(SessionStore store, ConnectorLimits limits, ProducerCredential credential)
{
    private readonly SemaphoreSlim ingress = new(4, 4);

    public void Map(WebApplication app)
    {
        var api = app.MapGroup("/api/connector/v1/sessions");
        api.MapPost("", (Delegate)((HttpContext context) => Receive<Registration>(context, store.Register)));
        api.MapPost("/{id}/batches", (HttpContext context, string id) =>
            Receive<ConnectorBatch>(context, batch => store.Publish(id, batch)));
        api.MapPost("/{id}/end", (HttpContext context, string id) =>
            Receive<EndSession>(context, request => store.End(id, request)));
    }

    private async Task<IResult> Receive<T>(HttpContext context, Func<T, StoreResult> accept)
    {
        var request = context.Request;
        if (!credential.Allows(request.Headers.Authorization))
            return Error(401, "invalid-credential", "Supply a valid producer bearer credential.");

        if (!request.HasJsonContentType())
            return Error(400, "invalid-content-type", "Send application/json.");

        if (request.ContentLength > limits.MaxBatchBytes)
            return Error(413, "body-too-large", "The request exceeds the advertised byte limit.");

        if (!ingress.Wait(0))
            return Busy(context);

        try
        {
            var maxBody = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (maxBody is { IsReadOnly: false })
                maxBody.MaxRequestBodySize = limits.MaxBatchBytes;

            var message = await JsonSerializer.DeserializeAsync<T>(request.Body, ConnectorMessages.Json, context.RequestAborted);
            if (message is null)
                return Error(400, "invalid-json", "A JSON message is required.");

            var result = accept(message);
            if (result.Status == 429)
                return Busy(context);
            if (result.Code is { } code)
                return Error(result.Status, code, Explain(code));

            return result.Value is { } value
                ? Results.Json(value, ConnectorMessages.Json, statusCode: result.Status)
                : Results.StatusCode(result.Status);
        }
        catch (JsonException)
        {
            return Error(400, "invalid-json", "The JSON message does not match the v1 contract.");
        }
        catch (BadHttpRequestException error) when (error.StatusCode == 413)
        {
            return Error(413, "body-too-large", "The request exceeds the advertised byte limit.");
        }
        finally
        {
            ingress.Release();
        }
    }

    private static IResult Busy(HttpContext context)
    {
        context.Response.Headers.RetryAfter = "1";
        return Error(429, "ingress-busy", "Retry the same batch after the indicated delay.");
    }

    private static IResult Error(int status, string code, string message) =>
        Results.Json(new ConnectorError(code, message), ConnectorMessages.Json, statusCode: status);

    private static string Explain(string code) => code switch
    {
        "unsupported-version" => "Use connector contract version 1.",
        "session-in-use" => "End the existing session before registering another source.",
        "registration-conflict" => "Reuse the same payload for a retried request ID.",
        "sequence-conflict" => "Retry the original batch or publish a later nonoverlapping interval.",
        "unknown-session" => "Register the source and use its assigned session ID.",
        "session-ended" => "Register a new session with a fresh request ID.",
        "invalid-reference" => "Check topology references and the session's declared metric capabilities.",
        _ => "Check the payload against the v1 connector contract."
    };
}

internal sealed class ProducerCredential(string token)
{
    private readonly byte[] expected = Encoding.UTF8.GetBytes(token);

    public bool Allows(string? value) =>
        AuthenticationHeaderValue.TryParse(value, out var authorization) &&
        authorization.Scheme.Equals("Bearer", StringComparison.OrdinalIgnoreCase) &&
        authorization.Parameter is { } actual &&
        CryptographicOperations.FixedTimeEquals(expected, Encoding.UTF8.GetBytes(actual));
}
