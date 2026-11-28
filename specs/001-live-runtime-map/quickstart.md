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

To exercise Calls on the demo stand, run the prepared workload with `dotnet $env:CODEORGANISM_TEST_CALL_TARGET --calls --repeat`. Keep it running, refresh the process list and attach to the printed PID. The Calls button becomes available after the connector discovers entry checkpoints. The demo alternates two call loads automatically.

The Windows connector estimates CPU from ETW on-CPU stack sampling and managed allocation rate from weighted .NET EventPipe allocation ticks. The Inspector displays the unit, window and any estimate or partial coverage beside the current reading. The method ranking shows the highest observed rates during the session, with covered-only call counts shown separately from complete rates.

Set `CODEORGANISM_TEST_BUNDLE` to the absolute publish directory to run Playwright against the offline bundle from outside the repository. [Publish the Windows x64 bundle](../../README.md#publish-for-offline-use).

## Acceptance matrix

| Scenario | Procedure and pass condition |
|---|---|
| CPU live and truthful (SC-001) | Warm the process first. Alternate long enough compute bursts in two named methods while a third method waits. Start the observer after warmup. Both busy phases identify the expected method and the waiting method ranks below the corresponding busy method. Verify readable managed names, one common connector path and an unresolved case. |
| CPU speed and cost (SC-002) | Run at least 10 paired baseline/capture trials with the same fixture, machine and warmup. Compute median elapsed-time overhead from paired ratios. Compare scenario transitions with the browser paint timestamp through a shared test timing reference. Use the agreed foreground profile, record each transition and compare to the spec. |
| Allocation rate (SC-003) | Alternate light and heavy allocation phases on known methods. Compare direction and ranking with per-thread allocated-byte reference deltas. Verify estimation labels and the unattributed case. See [allocation validation](validation/allocations.md). |
| Exact calls (SC-003) | Start the prepared build, attach after startup, and collect before and after checkpoints around a controlled call workload. Compare the sum of complete interval counts with the known total. Include multiple threads, recursion and an exception case. Verify uninstrumented methods and partial intervals are labeled. Measure the cost against the same workload built without active probes. |
| UI and pause (SC-004) | Inspect the three reference states at 1440 and 640 px in normal and reduced motion. Check connected and disconnected groups, self-loop hover, wheel zoom under the pointer, pan, and Collapse all. Verify that metric updates preserve coordinates, focus, list scroll and disclosure state. Pause across a workload change, explore the frozen view, then resume. Check the relationship halo and the combined metric channels. |
| Open connector (SC-005) | Start the stand-alone example, grant it a producer credential and publish one metric. Verify missing metrics, incompatible version and a competing source. Confirm the first-party connector uses the same path. |
| Failure paths | Exercise denied privileges, disabled diagnostics, target exit and measurement gaps. Verify that a valid Attach locks the map and inspector while pending. Keep Detach available when the host permits it. Check that an older session cannot unlock the workspace, and that live data for the requested PID or a terminal failure releases it and restores focus. Stall the browser and overload ingestion separately. Verify bounded memory, current-state recovery, accurate loss status, no persisted telemetry and that detach leaves the target running. |
| Offline distribution | After packaging, run the bundle offline and verify its browser assets and diagnostics work without external network services. |

Record evidence under `validation/` in the feature directory: environment and profile, measurements, limitations, and visual captures. The CPU-only PoC requires CPU live, latency and overhead qualification. Complete every matrix row for MVP acceptance.

For the workspace and graphics follow-up, run `npm.cmd --prefix tests/browser test -- cpu-map.spec.ts map-usability.spec.ts settings.spec.ts` against the Windows bundle. At 1440 and 640 px, check that the map spans the workspace and the three disclosures sit below it. Refresh the process list by keyboard and verify the selected process remains selected. Close the ranking and Inspector, interact with nodes and branches, then reopen both to check the current readings and loss messages.

Check wheel zoom under the pointer and the zoom buttons and keyboard shortcuts. Type a percentage and press Enter, then try another and leave the field with Tab. Verify the field clamps to approximately 7.78% and 2474.87%, restores the last percentage after invalid input, and returns to 100% on Reset view.

Open Settings with a live or paused map. A small increase from measured zero must be visible in every preset. Low shows a temporary static highlight. Balanced animates the pulse and glow. High lights more branches and adds wider halos and stronger node lighting. In Combined, check that CPU still pulses, allocation changes node size, and calls use a separate halo. Hover or select a branch to highlight its immediate neighbors without shifting the graph. Repeat with the system reduced-motion setting and in the White, Dark and Purple themes. Use the [render performance procedure](validation/render-performance.md) for the dense foreground comparison by preset.

Select **Top methods** under **Ranking view** to see every method observed in the session. Collapse all groups and verify the same rows and peaks remain. A row without a reading for the selected metric shows **Unavailable**. In the page layout, expand Groups and scroll the page to reach the last child.

Open fullscreen using the button at the lower-right corner of the map. Drag each panel by its handle or focus the handle and use the arrow keys. Hold Shift for a larger step. Open or close each panel by its heading and scroll inside any panel whose content exceeds its height. Exit with Escape or the map button and verify the same panels return beneath the map with their disclosure state, selected node and zoom intact.
