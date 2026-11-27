using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace CodeOrganism.Protocol;

public sealed record ConnectorReply(HttpStatusCode Status, ConnectorError? Error, RegisteredSession? Session)
{
    public bool IsSuccess => (int)Status is >= 200 and < 300;
}

public sealed class ConnectorClient : IDisposable
{
    private const string Sessions = "api/connector/v1/sessions";
    private const int MaxAttempts = 3;
    private static readonly TimeSpan AttemptTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(2);
    private readonly HttpClient http;
    private readonly AuthenticationHeaderValue authorization;
    private long? failedSequence;
    private bool failedBatchCarriedGap;
    private string? publisherSession;
    private int sending;

    public ConnectorClient(Uri origin, string token, HttpMessageHandler? handler = null)
    {
        if (!origin.IsAbsoluteUri || origin.Scheme != Uri.UriSchemeHttp || origin.Host != "127.0.0.1" ||
            origin.AbsolutePath != "/" || origin.UserInfo.Length != 0 || origin.Query.Length != 0 || origin.Fragment.Length != 0)
            throw new ArgumentException("Use the host's HTTP loopback origin.", nameof(origin));

        ArgumentException.ThrowIfNullOrWhiteSpace(token);
        authorization = new("Bearer", token);
        http = new HttpClient(handler ?? new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false })
        {
            BaseAddress = origin,
            Timeout = Timeout.InfiniteTimeSpan
        };
    }

    public Task<ConnectorReply> RegisterAsync(Registration registration, CancellationToken cancellationToken = default) =>
        PostAsync(Sessions, registration, receiveSession: true, cancellationToken);

    public async Task<ConnectorReply> PublishAsync(string sessionId, ConnectorBatch batch, CancellationToken cancellationToken = default)
    {
        if (Interlocked.Exchange(ref sending, 1) != 0)
            throw new InvalidOperationException("Finish publishing the current batch before sending another.");

        try
        {
            if (publisherSession != sessionId)
            {
                publisherSession = sessionId;
                failedSequence = null;
                failedBatchCarriedGap = false;
            }

            var needsGap = failedSequence is { } previous && (previous != batch.Sequence || failedBatchCarriedGap);
            if (needsGap && !batch.Loss.Any(x => x.Kind == LossKind.SourceGap))
                batch = batch with { Loss = [.. batch.Loss, new(LossKind.SourceGap)] };

            // Until acknowledged, the host may or may not have received this sequence.
            failedSequence = batch.Sequence;
            failedBatchCarriedGap = needsGap;
            var reply = await PostAsync(SessionPath(sessionId, "batches"), batch, receiveSession: false, cancellationToken);
            if (reply.IsSuccess)
            {
                failedSequence = null;
                failedBatchCarriedGap = false;
            }

            return reply;
        }
        finally
        {
            Volatile.Write(ref sending, 0);
        }
    }

    public Task<ConnectorReply> EndAsync(string sessionId, EndSession ending, CancellationToken cancellationToken = default) =>
        PostAsync(SessionPath(sessionId, "end"), ending, receiveSession: false, cancellationToken);

    public void Dispose() => http.Dispose();

    private async Task<ConnectorReply> PostAsync<T>(string path, T payload, bool receiveSession, CancellationToken stop)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, ConnectorMessages.Json);
        for (var attempt = 1; ; attempt++)
        {
            var retryDelay = TimeSpan.FromMilliseconds(100 * attempt);
            using (var attemptStop = CancellationTokenSource.CreateLinkedTokenSource(stop))
            {
                attemptStop.CancelAfter(AttemptTimeout);
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new ByteArrayContent(bytes) };
                    request.Headers.Authorization = authorization;
                    request.Content.Headers.ContentType = new("application/json");
                    using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, attemptStop.Token);
                    var canRetry = attempt < MaxAttempts &&
                        (response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500);
                    if (canRetry && response.Headers.RetryAfter is { } hint)
                        retryDelay = hint.Delta ?? (hint.Date.GetValueOrDefault(DateTimeOffset.UtcNow) - DateTimeOffset.UtcNow);

                    if (!canRetry || retryDelay > MaxRetryDelay)
                        return await ReadReplyAsync(response, receiveSession, attemptStop.Token);
                }
                catch (OperationCanceledException) when (!stop.IsCancellationRequested)
                {
                    if (attempt == MaxAttempts)
                        return RetryLimit();
                }
                catch (HttpRequestException)
                {
                    if (attempt == MaxAttempts)
                        return RetryLimit();
                }
            }

            await Task.Delay(retryDelay > TimeSpan.Zero ? retryDelay : TimeSpan.Zero, stop);
        }
    }

    private static async Task<ConnectorReply> ReadReplyAsync(HttpResponseMessage response, bool receiveSession, CancellationToken stop)
    {
        var status = response.StatusCode;
        if (response.IsSuccessStatusCode && !receiveSession)
            return new(status, null, null);

        if (!string.Equals(response.Content.Headers.ContentType?.MediaType, "application/json", StringComparison.OrdinalIgnoreCase))
            return response.IsSuccessStatusCode ? InvalidRegistrationReply() : new(status, null, null);

        try
        {
            await using var body = await response.Content.ReadAsStreamAsync(stop);
            if (!response.IsSuccessStatusCode)
                return new(status, await JsonSerializer.DeserializeAsync<ConnectorError>(body, ConnectorMessages.Json, stop), null);

            var session = await JsonSerializer.DeserializeAsync<RegisteredSession>(body, ConnectorMessages.Json, stop);
            return session is null ? InvalidRegistrationReply() : new(status, null, session);
        }
        catch (JsonException)
        {
            return response.IsSuccessStatusCode ? InvalidRegistrationReply() : new(status, null, null);
        }
    }

    private static ConnectorReply RetryLimit() => new(HttpStatusCode.ServiceUnavailable,
        new("retry-limit", "The host did not acknowledge the message within the retry budget."), null);

    private static ConnectorReply InvalidRegistrationReply() => new(HttpStatusCode.BadGateway,
        new("invalid-reply", "The host did not return a valid registration response."), null);

    private static string SessionPath(string sessionId, string action)
    {
        if (string.IsNullOrEmpty(sessionId) || !sessionId.All(char.IsAsciiLetterOrDigit))
            throw new ArgumentException("Invalid session ID.", nameof(sessionId));

        return $"{Sessions}/{sessionId}/{action}";
    }
}
