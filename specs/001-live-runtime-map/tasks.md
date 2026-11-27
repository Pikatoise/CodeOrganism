# Tasks: Live Runtime Map

**Input**: [Specification](spec.md), [technical plan](plan.md), [research](research.md), [data model](data-model.md), [connector contract](contracts/connector-v1.md), [design](DESIGN.md), [acceptance](quickstart.md)

## Phase 1: Setup

- [X] T001 Create `CodeOrganism.slnx` with the host, protocol, Windows connector and test projects under `src/` and `tests/`.
- [X] T002 [P] Scaffold TypeScript and Vite in `src/web/package.json` and `src/web/vite.config.ts` and document the local toolchain in `README.md`.
- [X] T003 [P] Add the confirmed MIT license in `LICENSE`.

## Phase 2: Foundational

- [X] T004 Define v1 messages and field validation in `src/CodeOrganism.Protocol/ConnectorMessages.cs` and add wire tests in `tests/CodeOrganism.Tests/ConnectorMessagesTests.cs`. See [Session](data-model.md#session) (`Session.id`, `Session.source`, `Session.capabilities`, `Session.limits`), [Node](data-model.md#node) (`Node.id`, `Node.kind`, `Node.label`, `Node.library`), [Relationship](data-model.md#relationship) (`Relationship.identity`) and [Measurement](data-model.md#measurement) (`Measurement.interval`, `Measurement.metric`, `Measurement.value`, `Measurement.quality`, `Measurement.loss`).
- [X] T005 Implement authenticated loopback ingress, admission limits, retries, source exclusivity and lifecycle in `src/CodeOrganism.Host/ConnectorEndpoints.cs` and `src/CodeOrganism.Host/SessionStore.cs`. See [Session](data-model.md#session) (`Session.id`, `Session.state`, `Session.limits`) and [contract](contracts/connector-v1.md).
- [X] T006 Implement metric rollups and monotonic latest-snapshot publishing in `src/CodeOrganism.Host/SnapshotStream.cs`. See [Measurement](data-model.md#measurement) (`Measurement.attribution`, `Measurement.loss`) and [View snapshot](data-model.md#view-snapshot) (`Snapshot.version`).
- [X] T007 Implement the reusable publisher and bounded resend behavior in `src/CodeOrganism.Protocol/ConnectorClient.cs`. Verify lifecycle conflicts, duplicate and lost batch behavior, and slow browser recovery in `tests/CodeOrganism.Tests/SessionStoreTests.cs`.

## Phase 3: US1 - Find the source of CPU load (P1)

**Independent test**: Warm a normal release target, attach to it, and identify the busy method against a waiting control. Verify pause, inspection and detach.

### CPU PoC

- [X] T008 [P] [US1] Create deterministic busy/wait and transition timing scenarios in `samples/Workload.Console/Program.cs` and `samples/Workload.Web/Program.cs`.
- [X] T009 [P] [US1] Spike real-time ETW on a warm target in `src/CodeOrganism.Connector.DotNet/CpuCollector.cs`. Test privilege, live managed name resolution, process identity and sampling latency in `tests/CodeOrganism.Windows.Tests/CpuAttachTests.cs`.
- [X] T010 [US1] Convert CPU samples and observed adjacencies to common batches in `src/CodeOrganism.Connector.DotNet/ObservationPublisher.cs`. Implement exclusive attribution and stable IDs under [Node](data-model.md#node) and [Measurement](data-model.md#measurement).
- [X] T011 [US1] Consume live snapshots and render an organic CPU map in `src/web/src/main.ts` and `src/web/src/graph/map.ts`.
- [X] T012 [US1] Run the CPU PoC gate, settle the normal benchmark profile and record results in `specs/001-live-runtime-map/validation/cpu-poc.md`. If latency, attribution or overhead fail, revise the collection approach within this gate and rerun before proceeding to the CPU MVP slice.

### CPU MVP slice

- [X] T013 [P] [US1] Produce the three visual mockups and capture both widths under `specs/001-live-runtime-map/validation/design/` following [DESIGN.md](DESIGN.md).
- [ ] T014 [P] [US1] Implement connected, restricted, unsupported, exited and detached states and typed connector control in `src/CodeOrganism.Host/FirstPartyConnector.cs` and `src/CodeOrganism.Connector.DotNet/AttachSession.cs`. Use the privilege boundary in the plan, including cleanup after child exit or denied elevation. Keep the target alive on detach.
- [ ] T015 [US1] Implement stable layout, module and library grouping, pan, zoom, selection, ranking, pause/resume, gradual decay and reduced motion in `src/web/src/graph/layout.ts`, `src/web/src/graph/map.ts` and `src/web/src/inspector.ts`. See [View snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).
- [ ] T016 [US1] Check attach errors, no-symbol behavior, stale and incomplete state, and the two-width CPU workflow in `tests/CodeOrganism.Windows.Tests/CpuAttachTests.cs` and `tests/browser/cpu-map.spec.ts`.

## Phase 4: US2 - Find allocation hotspots (P2)

**Independent test**: A known allocating method rises in ranking and grows on the map when its allocated volume increases.

- [ ] T017 [P] [US2] Add controlled allocation phases and reference deltas in `samples/Workload.Console/AllocationScenario.cs`.
- [ ] T018 [P] [US2] Implement EventPipe allocation ingestion and weighted attribution in `src/CodeOrganism.Connector.DotNet/AllocationCollector.cs`. See [Measurement](data-model.md#measurement), especially `Measurement.quality` and `Measurement.attribution`.
- [ ] T019 [US2] Wire allocation capability into the publisher and size channel with metric selection and honest units in `src/CodeOrganism.Connector.DotNet/ObservationPublisher.cs` and `src/web/src/graph/metrics.ts`.
- [ ] T020 [US2] Validate heavy/light phases, unattributed work and unavailable versus zero readings in `tests/CodeOrganism.Windows.Tests/AllocationTests.cs` and `tests/browser/allocation-map.spec.ts`.

## Phase 5: US3 - Inspect method frequency and compare signals (P3)

**Independent test**: A prepared build produces the known call total and all three signals are independently readable in the combined view.

- [ ] T021 [P] [US3] Implement the opt-in checkpoint provider in `src/CodeOrganism.CallProbes/EntryCounters.cs` and add concurrent, recursive and throwing methods in `samples/Workload.Console/CallScenario.cs`.
- [ ] T022 [US3] Consume checkpoint deltas and publish covered counts in `src/CodeOrganism.Connector.DotNet/CallCollector.cs` and `src/CodeOrganism.Connector.DotNet/ObservationPublisher.cs`. Use the [Measurement](data-model.md#measurement) rules for interval, quality and coverage.
- [ ] T023 [US3] Implement call glow and combined display with explicit ranking metric in `src/web/src/graph/metrics.ts` and `src/web/src/inspector.ts`.
- [ ] T024 [US3] Validate exact totals, partial windows, combined signals and both widths in `tests/CodeOrganism.Windows.Tests/CallProbeTests.cs` and `tests/browser/combined-map.spec.ts`. Record probe overhead and the qualified workload in `specs/001-live-runtime-map/validation/call-probes.md`.

## Phase 6: US4 - Publish from another connector (P4)

**Independent test**: A standalone connector script publishes only call count and the browser correctly handles available, missing and incompatible data.

- [ ] T025 [P] [US4] Write the stand-alone HTTP publisher and onboarding instructions in `samples/Connector.Example/publish.ps1` and `samples/Connector.Example/README.md`. Follow the [v1 contract](contracts/connector-v1.md).
- [ ] T026 [US4] Expose explicit local connector authorization in `src/CodeOrganism.Host/ConnectorAuthorization.cs` and document it in `README.md`.
- [ ] T027 [US4] Verify the sample's availability, incompatible-version and session-conflict paths in `tests/browser/connector-example.spec.ts`.

## Phase 7: Release validation

- [ ] T028 Package local browser assets and connector binaries from `src/CodeOrganism.Host/CodeOrganism.Host.csproj`. Verify the bundle works offline and include required notices in `THIRD-PARTY-NOTICES.md`.
- [ ] T029 Run the [acceptance matrix](quickstart.md) and record results and performance qualifications in `specs/001-live-runtime-map/validation/mvp.md`.

## Dependencies & Execution Order

Setup → foundation → US1 PoC → US1 product slice → US2 → US3 → release. US4's sample and contract checks may start after foundation. Finish US4 before release. Within US1, T008 and T009 can run in parallel. After the PoC gate, T013 and T014 can run in parallel. Finish the visual references before T015 implements production layout. In US2, T017 and T018 can run in parallel before integration. In US3, T021 precedes checkpoint consumption, while browser development can test the combined display using contract fixtures once US2 is stable. In US4, T025 can develop against the documented contract while T026 implements authorization.

Release requires all four stories and every acceptance matrix row. The CPU PoC alone is a distinct checkpoint. Keep future recording, multi-process views and integrations outside this task list.
