# Implementation Plan: Live Runtime Map

**Feature**: `001-live-runtime-map` | **Date**: 2026-11-27 | **Spec**: [Live Runtime Map](spec.md)

## Summary

Build a local browser visualizer and a separate Windows .NET connector. Prove live CPU attribution on a warm process before building the complete MVP. Deliver the MVP in the order CPU, allocations, exact method frequency. The same public ingestion contract serves the .NET connector and third-party producers.

## Technical Context

| Area | Decision |
|---|---|
| Supported target | Windows 11 x64, CoreCLR .NET 10 LTS x64, local process. Validate a release console target and an ASP.NET Core target. Native AOT, containers and other runtimes are outside the verified v1 matrix. |
| Backend | C# / .NET 10, ASP.NET Core loopback host. Use TraceEvent for real-time ETW and EventPipe parsing and the diagnostics client for EventPipe attach. |
| CPU | Real-time ETW sampled CPU profiles, managed frame resolution from runtime method metadata/rundown. Qualify warm attach, selective elevation, latency and overhead in PoC. |
| Allocations | Managed allocation ticks and event stacks through EventPipe. Label method-level attribution as estimated. |
| Exact calls | Optional prepared target build with entry probes for selected synchronous managed methods. The standard target attach stays available. |
| Browser | TypeScript, Vite, Canvas 2D and semantic HTML. Use a topology-driven seeded layout and independent animation state. |
| Transport and storage | Versioned loopback HTTP JSON for producers, same-origin SSE for browser snapshots. In-memory session with bounded ingestion and a single latest snapshot. No telemetry disk files or outbound network dependencies. |
| Tests | Unit and contract checks, Windows integration fixtures, browser checks and paired benchmark runs. See [quickstart](quickstart.md). |

## Constitution Check

The repository contains an unratified Spec Kit constitution template. No ratified provisions apply. Before research and after design, check the confirmed product constraints: local-only, shared open ingress, honest metric labels, and PoC before MVP. This plan and its contracts preserve all four. Use the confirmed MIT licensing decision when publishing source.

## Project Structure

```text
src/
  CodeOrganism.Host/              # process control, loopback host and session read model
  CodeOrganism.Protocol/          # wire schema and reference client
  CodeOrganism.Connector.DotNet/  # Windows/.NET attach, attribution and publisher
  CodeOrganism.CallProbes/        # optional exact-mode helper for prepared builds
  web/                           # browser map and accessible HTML UI
samples/
  Workload.Console/
  Workload.Web/
  Connector.Example/
tests/
  CodeOrganism.Tests/
  CodeOrganism.Windows.Tests/
  browser/
```

Keep runtime-specific discovery, attach and metric interpretation in the connector. The host launches the installed, unelevated first-party connector and relays typed process-selection commands through private stdio. The host never parses ETW or EventPipe. Third-party connectors start separately and publish through the same [ingress](contracts/connector-v1.md). If ETW requires elevation, explicitly prompt for a narrowly scoped Windows worker using a current-user-bound private named pipe, a per-launch nonce and one verified target. The browser, host and main connector remain unelevated. Only the worker manages the elevated trace and it shuts down when the connector closes.

## Stage gates

1. **CPU PoC**: establish a repeatable warm attach, resolve fixture method names while live and expose unresolved work, rank computation over waiting, and demonstrate the contract and browser. Run the latency and overhead baseline. If the ETW candidate fails, document the failure and qualify an alternative against the same checks before treating CPU as delivered. A stack-appearance demo is useful evidence for topology.
2. **CPU MVP slice**: adopt the [visual references](DESIGN.md), complete attach/error states, accessibility and pause semantics. The connector example can proceed independently and ships with MVP. Record the qualified Windows matrix and control workload in the quickstart evidence.
3. **Allocations**: pass direction and ranking checks and verify double counting, unknown attribution and estimation labels.
4. **Exact calls and combined view**: verify supported probe scope and known counts, measure overhead and record the acceptable profile before signing off. Browser attach to the already-running prepared build follows the same workflow.
5. **Release**: run all [quickstart](quickstart.md) scenarios, check the offline bundle and MIT notices, and record results. Multi-process maps, recordings and IDE integration remain follow-up features.

## Performance protocol

Start with one foreground tab and a representative fixture of 12 modules, up to 250 visible methods and 750 visible relationships. At PoC completion, publish machine, OS, runtime, browser, fixture sizes and transition rates, and the observed ceiling. Use paired repeated runs with CPU-only capture on and off. Fix the profile before final measurements. Measure elapsed-time overhead against baseline and transition-to-browser-paint latency for the same profile. Test overload separately, including bounded memory, staleness, incomplete intervals and recovery. Keep the performance targets in [SC-002](spec.md#measurable-outcomes).
