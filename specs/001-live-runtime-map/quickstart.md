# Quickstart and Acceptance

This guide defines validation for the live runtime map. See the [MVP validation report](validation/mvp.md) for the release run.

## Orca handoff

Work from the repository root. This feature directory is `specs/001-live-runtime-map`. Use an implementation branch named `001-live-runtime-map` so Spec Kit can resolve it in a new checkout without the local feature pointer. Start at T001 in [tasks.md](tasks.md). The PoC gate at T012 controls progression to the production UX and additional metrics.

## Setup

Use Windows 11 x64, the .NET 10 SDK, and Microsoft Edge. Use Node.js 24 for frontend build and browser tests. The CPU collector may need elevation for ETW. Keep the host and browser unelevated during normal use. See the [CPU PoC](validation/cpu-poc.md) for the measured profile.

Run these commands from the repository root:

```powershell
dotnet build CodeOrganism.slnx -c Release
dotnet test CodeOrganism.slnx -c Release
npm --prefix src/web ci
npm --prefix src/web run build
dotnet run --project src/CodeOrganism.Host -c Release
dotnet run --project samples/Workload.Console -c Release
```

The host prints its loopback address. Open it and choose the started workload by process name and PID. Repeat warm attach with the web fixture and verify a release fixture with debug symbols removed. Use the [visible design states](DESIGN.md) and [metric model](data-model.md#measurement) during validation.

## CPU browser workflow

Build the solution and browser assets in Release before testing. Install Microsoft Edge for the browser suite.

```powershell
dotnet test CodeOrganism.slnx -c Release
npm.cmd --prefix tests/browser ci
npm.cmd --prefix tests/browser test
```

Run the browser suite from an elevated Windows test shell with `CODEORGANISM_TEST_ETW=1` to exercise real capture and detach. The regular suite covers the responsive map, pause and resume, CPU coverage, process error handling and request authorization. In normal use, the browser and host can run unelevated. Approve the Windows prompt for the collector when attaching.

Set `CODEORGANISM_TEST_CALL_TARGET` to the prepared console DLL to include the live call tests. [Build and run the prepared workload](validation/call-probes.md#qualified-scope).

Set `CODEORGANISM_TEST_BUNDLE` to the absolute publish directory to run Playwright against the offline bundle from outside the repository. [Publish the Windows x64 bundle](../../README.md#publish-for-offline-use).

## Acceptance matrix

| Scenario | Procedure and pass condition |
|---|---|
| CPU live and truthful (SC-001) | Warm the process first. Alternate long enough compute bursts in two named methods while a third method waits. Start the observer after warmup. Both busy phases identify the expected method and the waiting method ranks below the corresponding busy method. Verify readable managed names, one common connector path and an unresolved case. |
| CPU speed and cost (SC-002) | Run at least 10 paired baseline/capture trials with the same fixture, machine and warmup. Compute median elapsed-time overhead from paired ratios. Compare scenario transitions with the browser paint timestamp through a shared test timing reference. Use the agreed foreground profile, record each transition and compare to the spec. |
| Allocation rate (SC-003) | Alternate light and heavy allocation phases on known methods. Compare direction and ranking with per-thread allocated-byte reference deltas. Verify estimation labels and the unattributed case. See [allocation validation](validation/allocations.md). |
| Exact calls (SC-003) | Start the prepared build, attach after startup, and collect before and after checkpoints around a controlled call workload. Compare the sum of complete interval counts with the known total. Include multiple threads, recursion and an exception case. Verify uninstrumented methods and partial intervals are labeled. Measure the cost against the same workload built without active probes. |
| UI and pause (SC-004) | Inspect the three reference states at both widths. Verify expandable library grouping, leader-to-node navigation, stable positions, visual decay and each metric channel. Pause across a workload change, explore the frozen view, then resume at the current state. Repeat with reduced motion and keyboard navigation. |
| Open connector (SC-005) | Start the stand-alone example, grant it a producer credential and publish one metric. Verify missing metrics, incompatible version and a competing source. Confirm the first-party connector uses the same path. |
| Failure paths | Exercise denied privileges, disabled diagnostics, target exit and measurement gaps. Stall the browser and overload ingestion separately. Verify bounded memory, current-state recovery, accurate loss status, no persisted telemetry and that detach leaves the target running. |
| Offline distribution | After packaging, run the bundle offline and verify its browser assets and diagnostics work without external network services. |

Record evidence under `validation/` in the feature directory: environment and profile, measurements, limitations, and visual captures. The CPU-only PoC requires CPU live, latency and overhead qualification. Complete every matrix row for MVP acceptance.
