using System.Text.Json;
using CodeOrganism.Protocol;

namespace CodeOrganism.Tests;

public class ConnectorMessagesTests
{
    [Fact]
    public void ReadsDocumentedRegistration()
    {
        const string json = """
            {
              "requestId": "fixture-1",
              "version": 1,
              "source": { "id": "sample", "label": "Sample connector" },
              "capabilities": [{ "metric": "calls", "unit": "count", "method": "entry-counter", "quality": "exact" }]
            }
            """;

        var registration = JsonSerializer.Deserialize<Registration>(json, ConnectorMessages.Json)!;

        Assert.Null(ConnectorMessages.Validate(registration));
        Assert.Equal(Metric.Calls, Assert.Single(registration.Capabilities).Metric);
        Assert.Contains("\"metric\":\"calls\"", JsonSerializer.Serialize(registration, ConnectorMessages.Json));
    }

    [Theory]
    [InlineData("calls", "byte", "invalid-capability")]
    [InlineData("cpu", "ms", null)]
    public void ChecksCapabilityUnits(string metric, string unit, string? expected)
    {
        var registration = new Registration("request", 1, new ConnectorSource("fixture", "Fixture"),
            [new MetricCapability(Enum.Parse<Metric>(metric, ignoreCase: true), unit, "test", Quality.Estimated)]);

        Assert.Equal(expected, ConnectorMessages.Validate(registration));
        Assert.Equal("unsupported-version", ConnectorMessages.Validate(registration with { Version = 2 }));
    }

    [Theory]
    [InlineData(0.5, Quality.Exact, true, "invalid-measurement")]
    [InlineData(-1.0, Quality.Exact, true, "invalid-measurement")]
    [InlineData(0.0, Quality.Exact, false, "invalid-measurement")]
    [InlineData(1.0, Quality.Unavailable, false, "invalid-measurement")]
    [InlineData(null, Quality.Unavailable, false, null)]
    [InlineData(0.0, Quality.Exact, true, null)]
    public void ChecksCountCoverageAndUnavailableValues(double? value, Quality quality, bool complete, string? expected)
    {
        var batch = new ConnectorBatch(1, 0, 1000,
            [new GraphNode("module", NodeKind.Module, "Module"), new GraphNode("method", NodeKind.Method, "Run", "module")],
            [new GraphRelationship("method", "method", Evidence.StackAdjacency)],
            [new Observation("method", Metric.Calls, value, quality, complete)], []);

        Assert.Equal(expected, ConnectorMessages.Validate(batch));
        Assert.Equal("invalid-batch", ConnectorMessages.Validate(batch with { EndMs = 0 }));
    }

    [Fact]
    public void RejectsDuplicateMeasurementsAndMissingLocalParent()
    {
        var measure = new Observation("method", Metric.Calls, 1, Quality.Exact, true);
        var batch = new ConnectorBatch(1, 0, 10, [new GraphNode("method", NodeKind.Method, "Run")],
            [], [measure, measure], []);

        Assert.Equal("invalid-node", ConnectorMessages.Validate(batch));
        Assert.Equal("duplicate-measurement", ConnectorMessages.Validate(batch with
        {
            Nodes = [new GraphNode("method", NodeKind.Method, "Run", "another-batch")]
        }));
    }

    [Fact]
    public void RejectsIntegerEnumsAndMissingRequiredWireFields()
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Observation>(
            """{"nodeId":"a","metric":0,"value":1,"quality":"exact","complete":true}""", ConnectorMessages.Json));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Observation>(
            """{"nodeId":"a","metric":"calls","quality":"exact","complete":true}""", ConnectorMessages.Json));
    }
}
