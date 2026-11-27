using System.Text.Json;
using CodeOrganism.Workload;

if (args is ["--benchmark", var blocksText] && int.TryParse(blocksText, out var blocks) && blocks > 0)
{
    var elapsed = CpuScenario.Measure(blocks);
    Console.WriteLine(JsonSerializer.Serialize(new { elapsedMs = elapsed.TotalMilliseconds, blocks }));
    return 0;
}

if (args.Length != 0)
{
    Console.Error.WriteLine("Usage: Workload.Console [--benchmark <positive-block-count>]");
    return 2;
}

using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, args) =>
{
    args.Cancel = true;
    stop.Cancel();
};

Console.WriteLine(JsonSerializer.Serialize(new { pid = Environment.ProcessId, phaseMs = 3_000 }));
await CpuScenario.RunAsync(TimeSpan.FromSeconds(3), phase =>
    Console.WriteLine(JsonSerializer.Serialize(phase, JsonSerializerOptions.Web)), stop.Token);
return 0;
