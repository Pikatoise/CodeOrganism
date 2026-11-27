# Windows ETW Spike

The CPU collector was run against a release .NET 10 console workload that was already running. The workload alternated three-second phases in `BusyAlpha` and `BusyBeta` while a separate thread waited in `WaitForSignal`.

A seven-second elevated Windows capture received 5,947 target samples and 6,045 target stack-walk events with zero ETW-reported loss. The collector resolved both busy methods from CLR metadata. The waiting method was absent from sampled on-CPU instructions. The maximum observed time from sample creation to the collector callback was 1,566 ms in this run. This measures collector dispatch. Browser latency and application overhead still require the CPU PoC acceptance run.

The console and web workload fixtures use the same CPU scenario and emit UTC and monotonic timestamps. The console fixture also has a fixed-work benchmark mode. The Windows integration test requires an elevated 64-bit test process and skips its kernel capture on other configurations.

Run the fixture and then use its PID:

```powershell
dotnet run --project samples/Workload.Console -c Release
dotnet run --project src/CodeOrganism.Connector.DotNet -c Release -- probe-cpu <pid> 7
```

The capture is real-time and in memory. The experimental CLI reports sampled CPU estimates. Stack attribution into the map and the full browser/benchmark gate follow in T010–T012.
