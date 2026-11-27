using System.Text.Json;
using CodeOrganism.Workload;

if (args is ["--calls"])
{
    await CallScenario.RunAsync();
    return 0;
}

if (args is ["--benchmark", _, ..] && args.Length is 2 or 3 &&
    int.TryParse(args[1], out var blocks) && blocks > 0 &&
    (args.Length == 2 || args[2] == "--pipe"))
{
    CpuScenario.WarmUp();
    if (args.Length == 2)
        MeasureAndReport();
    else
    {
        Console.WriteLine(JsonSerializer.Serialize(new { pid = Environment.ProcessId, ready = true }));
        while (Console.ReadLine() == "run")
            MeasureAndReport();
    }

    return 0;

    void MeasureAndReport()
    {
        var elapsed = CpuScenario.Measure(blocks);
        Console.WriteLine(JsonSerializer.Serialize(new { elapsedMs = elapsed.TotalMilliseconds, blocks }));
    }
}

if (args.Length != 0)
{
    if (args is not ["--allocations"])
    {
        Console.Error.WriteLine("Usage: Workload.Console [--allocations | --calls | --benchmark <positive-block-count> [--pipe]]");
        return 2;
    }
}

using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, args) =>
{
    args.Cancel = true;
    stop.Cancel();
};

if (args is ["--allocations"])
{
    Console.WriteLine(JsonSerializer.Serialize(new { pid = Environment.ProcessId, phaseMs = 3_000 }));
    AllocationScenario.Run(step => Console.WriteLine(JsonSerializer.Serialize(step, JsonSerializerOptions.Web)), stop.Token);
    return 0;
}

Console.WriteLine(JsonSerializer.Serialize(new { pid = Environment.ProcessId, phaseMs = 3_000 }));
await CpuScenario.RunAsync(TimeSpan.FromSeconds(3), phase =>
    Console.WriteLine(JsonSerializer.Serialize(phase, JsonSerializerOptions.Web)), stop.Token);
return 0;
