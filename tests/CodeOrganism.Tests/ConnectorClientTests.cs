using System.Net;
using System.Text.Json;
using CodeOrganism.Protocol;

namespace CodeOrganism.Tests;

public class ConnectorClientTests
{
    [Fact]
    public async Task RetriesAnIdenticalBatchWhenTheReplyIsLost()
    {
        using var server = new TestServer(null, HttpStatusCode.Accepted);
        using var client = Client(server);

        var result = await client.PublishAsync("session", Batch(1));

        Assert.Equal(HttpStatusCode.Accepted, result.Status);
        Assert.Equal(2, server.Payloads.Count);
        Assert.Equal(server.Payloads[0], server.Payloads[1]);
    }

    [Fact]
    public async Task BoundedRetriesReportGapOnNextSequence()
    {
        using var server = new TestServer(HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests,
            HttpStatusCode.TooManyRequests, HttpStatusCode.Accepted, HttpStatusCode.Accepted);
        using var client = Client(server);

        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PublishAsync("session", Batch(1))).Status);
        Assert.Equal(3, server.Payloads.Count);
        Assert.All(server.Payloads, body => Assert.DoesNotContain("source-gap", body));

        Assert.Equal(HttpStatusCode.Accepted, (await client.PublishAsync("session", Batch(2))).Status);
        var recovered = JsonSerializer.Deserialize<ConnectorBatch>(server.Payloads[3], ConnectorMessages.Json)!;
        Assert.Equal(2, recovered.Sequence);
        Assert.Equal(LossKind.SourceGap, Assert.Single(recovered.Loss).Kind);

        await client.PublishAsync("session", Batch(3));
        Assert.DoesNotContain("source-gap", server.Payloads[4]);
    }

    [Fact]
    public void RejectsNonLoopbackOrigin()
    {
        Assert.Throws<ArgumentException>(() => new ConnectorClient(new("https://127.0.0.1:1234"), "token"));
        Assert.Throws<ArgumentException>(() => new ConnectorClient(new("http://localhost:1234"), "token"));
    }

    private static ConnectorClient Client(TestServer server) => new(new("http://127.0.0.1:1234"), "token", server);
    private static ConnectorBatch Batch(int seq) => new(seq, (seq - 1) * 1000, seq * 1000, [], [], [], []);

    private sealed class TestServer(params HttpStatusCode?[] statuses) : HttpMessageHandler
    {
        public List<string> Payloads { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal("token", request.Headers.Authorization?.Parameter);
            var status = statuses[Payloads.Count];
            Payloads.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            if (status is null)
                throw new HttpRequestException("Simulate a lost reply.");

            var response = new HttpResponseMessage(status.Value);
            response.Headers.RetryAfter = new(TimeSpan.Zero);
            return response;
        }
    }
}
