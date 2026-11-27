# Research: Live Runtime Map

All decisions are design selections. Stage gates still require implementation measurements.

## Windows and .NET baseline

**Decision**: Qualify Windows 11 x64 and .NET 10 LTS x64 first. Validate both console and web targets.  
**Rationale**: This gives the first connector a narrow support matrix and a maintained LTS baseline. The wire protocol has no dependency on Windows or .NET.  
**Alternatives**: Simultaneous Linux and Docker support add collection and permission paths without changing the core contract. [Microsoft .NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)

## Live CPU and symbol attribution

**Decision**: Use ETW kernel CPU sampling and stack walking, then join the selected process's samples with managed methods. Request live CLR method metadata for code JIT-compiled before attach and consume later updates. Keep unresolved work separate and disable external symbol requests. Apply PID and process-start validation and discard unrelated samples before aggregation. Exercise real-time flush timing.  
**Rationale**: Windows CPU samples represent execution on a processor. EventPipe's standard thread-time sampling can include waiting threads. ETW may require elevated capture privileges. Promote only the collector, and surface a denied elevation or unavailable trace session in the browser. Warm symbol mapping, buffer latency and privilege behavior remain PoC gates.  
**Alternatives**: EventPipe observed stacks can populate topology. This can ship as a CPU metric only with independently qualified on-CPU attribution. Offline ETW traces are useful as validation evidence. [Windows CPU sampling](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/xperf/cpu-sampling-by-process) · [ETW session privileges](https://learn.microsoft.com/en-us/windows/win32/etw/configuring-and-starting-a-systemtraceprovider-session) · [TraceEvent guide](https://github.com/microsoft/perfview/blob/main/documentation/TraceEvent/TraceEventProgrammersGuide.md) · [.NET thread sampling](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace)

## Managed allocation rate

**Decision**: Use weighted allocation tick amounts and a resolved allocating frame, with a separate unattributed bucket for missing frames. Compare relative changes and ranking with controlled per-thread allocations.  
**Rationale**: The tick amount estimates allocated volume. A sampled object's size and the size of the live heap measure different quantities.  
**Alternatives**: Runtime-wide totals cannot locate a method-level hotspot. Exact per-allocation instrumentation adds overhead and complexity. [GC events](https://learn.microsoft.com/en-us/dotnet/fundamentals/diagnostics/runtime-garbage-collection-events) · [PerfView allocation attribution](https://github.com/microsoft/perfview/blob/main/src/PerfView/PerfViewData.cs#L4710-L4748)

## Exact method frequency

**Decision**: Start with an opt-in prepared build and a small documented helper that increments thread-safe counters at entry to selected synchronous managed methods. The helper publishes cumulative checkpoints to the .NET collector using a typed diagnostic provider. Use the first post-attach checkpoint as the baseline. Capture allocations and probes through one EventPipe session when both are present. While all metrics are active, align published windows with probe checkpoints and aggregate timestamped ETW and allocation observations into those windows. If a checkpoint misses the bounded publish deadline, publish the other metrics and mark the affected calls interval unavailable. Recover a longer call interval only when it does not overlap an accepted interval. Publish coverage.  
**Rationale**: Entry counters preserve meaningful exact totals over covered windows at lower transport cost than streaming individual calls. The original target can still run as a normal build for CPU and allocation profiling.  
**Alternatives**: A startup CLR profiler or attach-and-ReJIT may expand coverage after the MVP. They involve additional runtime handling such as callers with inlined bodies. Sampling cannot count entries. [RequestReJITWithInliners](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/profiling/icorprofilerinfo10-requestrejitwithinliners-method) · [EventSource overview](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/eventsource)

## Loopback streaming and rendering

**Decision**: Use loopback HTTP JSON with authenticated ingestion and SSE full latest snapshots for the browser. Use Canvas 2D with an HTML inspection path. Compute layout only on topology or visibility changes.  
**Rationale**: Connector publishers can use standard HTTP clients. Full snapshots let a slow browser resume without replay, and HTML exposes meaning independent of canvas animation.  
**Alternatives**: SignalR adds a protocol layer for a mostly one-way stream. WebGL and 3D can be evaluated after the 2D baseline. [Kestrel endpoints](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints?view=aspnetcore-10.0) · [SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html) · [Canvas performance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
