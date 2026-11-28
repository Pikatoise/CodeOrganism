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
- [X] T014 [P] [US1] Implement connected, restricted, unsupported, exited and detached states and typed connector control in `src/CodeOrganism.Host/FirstPartyConnector.cs` and `src/CodeOrganism.Connector.DotNet/AttachSession.cs`. Use the privilege boundary in the plan, including cleanup after child exit or denied elevation. Keep the target alive on detach.
- [X] T015 [US1] Implement stable layout, module and library grouping, pan, zoom, selection, ranking, pause/resume, gradual decay and reduced motion in `src/web/src/graph/layout.ts`, `src/web/src/graph/map.ts` and `src/web/src/inspector.ts`. See [View snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).
- [X] T016 [US1] Check attach errors, no-symbol behavior, stale and incomplete state, and the two-width CPU workflow in `tests/CodeOrganism.Windows.Tests/CpuAttachTests.cs` and `tests/browser/cpu-map.spec.ts`.

## Phase 4: US2 - Find allocation hotspots (P2)

**Independent test**: A known allocating method rises in ranking and grows on the map when its allocated volume increases.

- [X] T017 [P] [US2] Add controlled allocation phases and reference deltas in `samples/Workload.Console/AllocationScenario.cs`.
- [X] T018 [P] [US2] Implement EventPipe allocation ingestion and weighted attribution in `src/CodeOrganism.Connector.DotNet/AllocationCollector.cs`. See [Measurement](data-model.md#measurement), especially `Measurement.quality` and `Measurement.attribution`.
- [X] T019 [US2] Wire allocation capability into the publisher and size channel with metric selection and honest units in `src/CodeOrganism.Connector.DotNet/ObservationPublisher.cs` and `src/web/src/graph/metrics.ts`.
- [X] T020 [US2] Validate heavy/light phases, unattributed work and unavailable versus zero readings in `tests/CodeOrganism.Windows.Tests/AllocationTests.cs` and `tests/browser/allocation-map.spec.ts`.

## Phase 5: US3 - Inspect method frequency and compare signals (P3)

**Independent test**: A prepared build produces the known call total and all three signals are independently readable in the combined view.

- [X] T021 [P] [US3] Implement the opt-in checkpoint provider in `src/CodeOrganism.CallProbes/EntryCounters.cs` and add concurrent, recursive and throwing methods in `samples/Workload.Console/CallScenario.cs`.
- [X] T022 [US3] Consume checkpoint deltas and publish covered counts in `src/CodeOrganism.Connector.DotNet/CallCollector.cs` and `src/CodeOrganism.Connector.DotNet/ObservationPublisher.cs`. Use the [Measurement](data-model.md#measurement) rules for interval, quality and coverage.
- [X] T023 [US3] Implement call glow and combined display with explicit ranking metric in `src/web/src/graph/metrics.ts` and `src/web/src/inspector.ts`.
- [X] T024 [US3] Validate exact totals, partial windows, combined signals and both widths in `tests/CodeOrganism.Windows.Tests/CallProbeTests.cs` and `tests/browser/combined-map.spec.ts`. Record probe overhead and the qualified workload in `specs/001-live-runtime-map/validation/call-probes.md`.

## Phase 6: US4 - Publish from another connector (P4)

**Independent test**: A standalone connector script publishes only call count and the browser correctly handles available, missing and incompatible data.

- [X] T025 [P] [US4] Write the stand-alone HTTP publisher and onboarding instructions in `samples/Connector.Example/publish.ps1` and `samples/Connector.Example/README.md`. Follow the [v1 contract](contracts/connector-v1.md).
- [X] T026 [US4] Expose explicit local connector authorization in `src/CodeOrganism.Host/ConnectorAuthorization.cs` and document it in `README.md`.
- [X] T027 [US4] Verify the sample's availability, incompatible-version and session-conflict paths in `tests/browser/connector-example.spec.ts`.

## Phase 7: Release validation

- [X] T028 Package local browser assets and connector binaries from `src/CodeOrganism.Host/CodeOrganism.Host.csproj`. Verify the bundle works offline and include required notices in `THIRD-PARTY-NOTICES.md`.
- [X] T029 Run the [acceptance matrix](quickstart.md) and record results and performance qualifications in `specs/001-live-runtime-map/validation/mvp.md`.

## Phase 8: Map usability and performance baseline

**Purpose**: Establish how the current browser draws the graph and why connected nodes appear scattered. The follow-up applies to modules and methods inside one attached session, per [FR-001](spec.md#functional-requirements).

- [X] T030 [P] Profile the current Canvas 2D renderer in `src/web/src/graph/map.ts` and snapshot-driven UI in `src/web/src/main.ts`. Record the Windows and Edge versions, GPU and driver, display refresh rate, device pixel ratio, and the Canvas, rasterization and compositing status from `edge://gpu` in `specs/001-live-runtime-map/validation/render-performance.md`. Capture frame interval p50/p95, missed frames, long main-thread tasks, browser CPU use and input-to-paint latency for idle, live updates, wheel zoom and pan. Use the same foreground fixture, cadence and 1440/640 px viewports in all runs, with 12 modules and up to 250 visible methods and 750 relationships. Compare hardware acceleration enabled and disabled in separate browser profiles, and trace which work runs on the main thread and which uses the GPU. Set a refresh-rate-aware frame budget before implementation.
- [X] T031 [P] Audit `src/web/src/graph/layout.ts` and record a recommendation in `specs/001-live-runtime-map/validation/map-layout.md`. The current placement assigns module anchors in discovery order and fans methods around their parent, then projects relationships after placing nodes. Compare it with at least two topology-aware layouts, such as clustered component placement and a seeded, bounded force layout. Compare connected-edge length, crossings, label overlaps and node displacement after a topology update on identical fixtures, including disconnected components, self-loops and dense groups. Review the trade-offs and select an approach for both widths under [DESIGN.md](DESIGN.md).

## Phase 9: US1 follow-up - Navigate and read the live map

**Independent test**: At both widths, open a graph with connected modules and a disconnected group. Related nodes form readable clusters. Hover a branch, zoom under the pointer, and collapse all expansions in one action. Metric-only updates keep node positions stable, and the same controls work while paused.

- [X] T032 [US1] Implement the selected compact layout in `src/web/src/graph/layout.ts` using observed relationships and module membership. Keep disconnected components distinct, preserve recursion and the unresolved bucket, and keep the placement deterministic for the same topology. Bound repositioning when new topology arrives, and retain positions across metric changes, collapse and re-expansion. See [Relationship](data-model.md#relationship) (`Relationship.identity`) and [View snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).
- [X] T033 [US1] Add branch hover in `src/web/src/graph/map.ts`. Hit-test the visible curve or self-loop at the current scale and translation, prefer the nearest curve within a screen-pixel tolerance, and emphasize the edge and endpoints independently of activity. Clear hover when the pointer leaves, a drag starts or the edge disappears. Keep node selection available where a node and edge overlap. See [Relationship](data-model.md#relationship) (`Relationship.identity`).
- [X] T034 [US1] Enable wheel zoom without a modifier over the map in `src/web/src/graph/map.ts`. Anchor zoom at the world point beneath the pointer, normalize wheel deltas, bound the scale, and support both stepped mice and trackpads. Keep scroll outside the map and preserve keyboard zoom, buttons, pan and reset. See [View snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).
- [X] T035 [US1] Add a `Collapse all` action in `src/web/index.html` and `src/web/src/main.ts`. Close expanded library and module groups in one action, disable the control when all are closed, and move a hidden selection to its nearest visible ancestor. Preserve zoom, paused measurements and the rest of the current view state.

## Phase 10: US1 follow-up - Keep the workspace stable during updates and attach

**Independent test**: Feed snapshots with changing ranks, long labels and changing status messages at 1440 and 640 px. The map bounds and primary controls hold their positions, long lists scroll, and both panels can be collapsed by keyboard. Attach to another PID and exercise success and failure. The main workspace stays locked only while the new attachment is pending.

- [X] T036 [US1] Stabilize the workspace in `src/web/src/style.css`, `src/web/index.html` and `src/web/src/inspector.ts`. Reserve space for dynamic status, errors, coverage and changing metric controls. Give ranking and group lists bounded, independently scrollable regions that remain keyboard-accessible at both widths. Keep updates from moving the map or current keyboard focus, and preserve the scroll position of a list that the operator is reading.
- [X] T037 [US1] Make Top methods/Top modules and Groups independently collapsible with semantic disclosures in `src/web/index.html`, `src/web/src/inspector.ts` and `src/web/src/style.css`, following the inspector interaction. Preserve the disclosure state through snapshot updates and mode changes. Keep the selected ranking metric, ranking controls and group actions usable when reopened.
- [X] T038 [US1] Add a loading overlay in `src/web/src/control.ts`, `src/web/src/main.ts`, `src/web/index.html` and `src/web/src/style.css`. Lock map and inspection interactions for pointer and keyboard as soon as a valid attach request is submitted and unlock on the first live snapshot for the requested target or a terminal failure. Handle request rejection, denied elevation, target exit and connection loss without leaving the UI locked. Keep the existing detach route available when the host allows it, announce the pending state, restore focus and respect reduced motion. Verify a stale snapshot from the previous source cannot unlock the workspace. See [Session](data-model.md#session) (`Session.id`, `Session.state`) and the existing browser control flow.

## Phase 11: US3 follow-up - Make activity and interface transitions smooth

**Independent test**: Observe a branch as activity rises and fades in CPU and Combined modes, then switch modes and interact with buttons, disclosures and inspection text. The core remains legible, the halo fades gradually, and changing emphasis never changes layout or measurement values. Repeat with reduced motion and while paused.

- [X] T039 [US3] Render a legible relationship core and a soft, diffused neon halo with time-based rise and decay in `src/web/src/graph/map.ts`. Drive the halo from the existing activity signal, keep a quiet base stroke, and make hovered branches visually distinct from active branches. Keep edge glow distinguishable from the call-rate node halo in Combined mode, and freeze activity animation on pause. See [Relationship](data-model.md#relationship) (`Relationship.identity`) and [View snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).
- [X] T040 [US3] Add coordinated transitions for button hover and press, mode changes, text entry and exit, disclosures and the attach overlay in `src/web/src/style.css`, `src/web/src/main.ts`, `src/web/src/inspector.ts` and `src/web/src/graph/map.ts`. Update measurements and accessible status immediately, preserve focus, and render the transition within stable bounds. Rapid toggles must settle on the newest state. Honor `prefers-reduced-motion` with static emphasis or brief non-motion transitions.

## Phase 12: Rendering optimization and follow-up acceptance

- [X] T041 Apply the optimizations supported by the T030 trace in `src/web/src/graph/map.ts`, `src/web/src/graph/layout.ts` and `src/web/src/main.ts`. Check reuse of layout projections and edge paths, redraw only when needed for visible state or animation, bound glow cost and per-frame allocation, and coalesce rapid input and snapshots. Reprofile against T030 in `specs/001-live-runtime-map/validation/render-performance.md`. If the optimized Canvas 2D path misses the recorded frame budget, compare a targeted OffscreenCanvas or WebGL prototype on the same workload before choosing a renderer. Verify usable interaction and readable evidence with acceleration disabled.
- [X] T042 Run the Phase 9–11 acceptance scenarios in the packaged browser build using both widths and normal and reduced motion. In `specs/001-live-runtime-map/validation/map-usability.md`, record captures, remaining dense-graph limitations, before/after navigation and layout results, and link the repeatable GPU and latency measurements. Recheck the affected rows of `specs/001-live-runtime-map/quickstart.md` and the existing browser workflows under `tests/browser/`.

## Phase 13: US1 follow-up - Widen the map and simplify navigation

**Independent test**: At 1440 and 640 px, refresh process discovery with the leading icon. Open and close each panel below the map. It shows only its heading when closed, even during a reported measurement loss. Pick nodes and interact with branches without opening panels. Inspect a close pair, a long diagonal, reciprocal edges and a real self-loop. Use the wheel, buttons and zoom field to change the scale. Verify that the field tracks the applied scale, that an entry below the minimum or above the maximum snaps to the respective limit, and that Reset restores 100%.

- [X] T043 [US1] Stack the inspection area beneath the full-width map at both widths in `src/web/index.html` and `src/web/src/style.css`. Preserve document order, independent scrolling within long lists and a layout that fits the viewport.
- [X] T044 [US1] Move `#refresh-processes` immediately left of the process selector in `src/web/index.html` and `src/web/src/style.css`. Use an icon with a localized accessible name and tooltip in English and Russian through `src/web/src/language.ts`. Keep keyboard activation, loading feedback and the current process selection when it is still available.
- [X] T045 [US1] Put coverage and loss messages inside the ranking disclosure in `src/web/index.html` and `src/web/src/style.css`. Remove reserved content height and spacing from closed disclosures. Update `src/web/src/main.ts` and `src/web/src/inspector.ts` so map interactions update selection without changing the open state of any panel. Keep measurements and loss messages available on manual reopen. Adjust the existing assertions in `tests/browser/cpu-map.spec.ts`, `tests/browser/map-usability.spec.ts` and `tests/browser/settings.spec.ts` where they rely on automatic opening. See [measurement loss](data-model.md#measurement) (`Measurement.loss`).
- [X] T046 [US1] Replace the fixed screen-space curl for ordinary edges in `src/web/src/graph/map.ts` with control points based on the endpoint chord and a bounded perpendicular bend. Keep short spans nearly straight, separate reciprocal edges with gentle bends, and give actual self-loops their own geometry. Share the same curve across drawing, hover and selection hit testing. Compare close, horizontal, vertical and long diagonal connections with the diagnosis in [the renderer report](validation/renderer-direction.md). See [relationship identity](data-model.md#relationship) (`Relationship.identity`).
- [X] T047 [US1] Expand the max-to-min zoom ratio by 50× from the existing 0.55–3.5 bounds in `src/web/src/graph/map.ts` and tune the button controls in `src/web/src/main.ts`. Use a symmetric expansion on a logarithmic scale, approximately 0.078–24.75. Add an editable zoom percentage field next to the + and − buttons in `src/web/index.html` and `src/web/src/style.css` with an accessible label in English and Russian in `src/web/src/language.ts`. Sync the field with the actual scale after wheel, button, keyboard, text entry and reset actions. Commit text entry on Enter or blur. Clamp values outside the shared bounds to the nearest limit and show the applied percentage. Restore the current percentage after empty or invalid input. Retain the mouse anchor and 1× reset, and handle labels, clipping and picking at both limits. See [view snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).

## Phase 14: US3 follow-up - Make graphics presets visually distinct

**Independent test**: Switch Low, Balanced and High on the same active CPU and Combined views in each theme. The same signals remain visible in every preset. Low shows a simple pulse and glow, and High adds wider, softer lighting and more highlighted branches. Pause or enable reduced motion and verify the effects remain readable. Reload and confirm the chosen preset is restored.

- [X] T048 [P] [US3] Extend the presets in `src/web/src/settings.ts` to define effect quality and quantity in addition to pixel ratio. Define preset values for effect passes or resolution, halo softness and the number of branches with enhanced effects. Keep the existing persisted preset names.
- [X] T049 [US3] Render a visible core, simple branch and node effects in Low, a fuller glow in Balanced, and richer layered halos and stronger node lighting in High in `src/web/src/graph/map.ts` and `src/web/src/style.css`. Apply the presets immediately and explain the options in `src/web/index.html` and `src/web/src/language.ts`. Keep CPU pulse, allocation size and call glow distinct, and preserve pause, reduced motion and theme readability. Give the High preset room for richer effects even if it misses the previous frame budget on the reference laptop. See [view snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).

## Phase 15: Cross-cutting acceptance

- [X] T050 Verify the Phase 13–14 scenarios in the packaged build at both widths and update `specs/001-live-runtime-map/quickstart.md` and `specs/001-live-runtime-map/validation/map-usability.md`. Reuse `tests/browser/profile-map.mjs` and the dense fixture to record performance by preset in `specs/001-live-runtime-map/validation/render-performance.md`. Check responsive navigation in Low and report the measured cost of High separately. Use the [renderer report](validation/renderer-direction.md) as the basis for any later GPU prototype.

## Phase 16: US1 follow-up - Compare visual directions and read dense maps

**Goal**: Improve the look of the live map and give the user concrete alternatives for reading similar or crowded networks of relationships.

**Independent review**: Use identical captures at 1440 and 640 px of a sparse component, the dense fixture, and two components with similar link patterns. Ask the user to identify a repeated pattern, follow an individual relationship, and choose a relationship view. Check direction, recursion, labels, selection, and the static activity highlight in Low.

- [X] T051 [P] [US1] Run a `grill-me` interview with the user on visual style and effects. Agree on the visual direction, where to apply motion and glow, the static version for Low, and what the comparison captures must show. Record confirmed decisions in `specs/001-live-runtime-map/DESIGN.md`.
- [X] T052 [P] [US1] Compare the current map with neighborhood focus, bundled links between modules with drill-down, and a synchronized adjacency matrix or aligned component views for comparing patterns. Reuse `tests/browser/map-fixture.mjs`. Present comparable captures, benefits, limits and a recommendation for review in `specs/001-live-runtime-map/validation/relationship-views.md`. Evaluate link traceability, repeated-pattern recognition, layout stability and interaction cost. Preserve [relationship identity](data-model.md#relationship) (`Relationship.identity`) in every alternative.
- [X] T053 [US1] Apply the [confirmed activity effects](DESIGN.md#activity-effects) and the reviewed relationship view in `src/web/src/graph/map.ts`, `src/web/src/graph/layout.ts`, `src/web/src/settings.ts` and `src/web/src/style.css`. Match the reference captures at both widths, make a zero-to-positive reading immediately visible, keep the metric channels distinct, and verify static emphasis in Low and animation in Balanced and High. Preserve pause and selection. See [view snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).

## Phase 17: US1 follow-up - Compare peaks and navigate groups

**Independent test**: Feed more than eight methods with alternating activity. Methods remain in the ranking through idle and missing intervals, and a higher measured rate moves the same row without duplication. Skip a browser update and verify the next snapshot carries the peak. Expand a module and a library group, select a nested method by keyboard, then collapse the parent. Compare all three disclosure headings at both widths.

- [X] T054 [P] [US1] Accumulate one peak per admitted method and metric in `src/CodeOrganism.Host/SessionStore.cs` on accepted batches. Expose the peak, winning interval and quality in `src/CodeOrganism.Host/SnapshotStream.cs`. Compare rates across window lengths, preserve the winning reading across lower, absent and unavailable readings, and reset when the session changes. Keep covered-only call counts distinct from complete rates. Document the session-bounded summary in `specs/001-live-runtime-map/data-model.md`. See [session](data-model.md#session) (`Session.id`, `Session.limits`), [measurement](data-model.md#measurement) (`Measurement.interval`, `Measurement.metric`, `Measurement.value`, `Measurement.quality`), and [view snapshot](data-model.md#view-snapshot) (`Snapshot.version`).
- [X] T055 [US1] Show all measured methods in `src/web/src/inspector.ts`, ordered by the session peak for the active ranking metric with stable ties. Label the values as peaks in `src/web/src/language.ts`. Keep a bounded scroll area and preserve row selection, focus and paused snapshots. Continue to show current readings in the Inspector.
- [X] T056 [US1] Give all three disclosure headings the same heading level and typography in `src/web/index.html` and `src/web/src/style.css`. In `src/web/src/inspector.ts`, display expanded modules, library groups and their descendants as nested lists with keyboard-accessible branch and leaf controls. Share expansion and selection with the map and preserve focus on the parent when collapsing its children. See [node](data-model.md#node) (`Node.id`, `Node.kind`, `Node.label`, `Node.library`) and [view snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).

## Phase 18: US2 follow-up - Keep the Inspector focused on readings

**Independent test**: Open the Inspector in CPU, Allocations and Combined modes. Check that the listed static CPU and allocation rows are gone, while units, estimates, missing readings and incomplete intervals remain distinguishable.

- [X] T057 [US2] Remove the separate CPU and allocation rows for measurement method, quality and coverage in `src/web/src/inspector.ts` and update translations in `src/web/src/language.ts`. Keep values, units and interval, show relevant estimate or incomplete status alongside the reading, and document static measurement methods in `specs/001-live-runtime-map/quickstart.md`. Update the Inspector requirement in `specs/001-live-runtime-map/spec.md` to reflect where this information appears. See [measurement](data-model.md#measurement) (`Measurement.quality`, `Measurement.loss`).

## Phase 19: US3 follow-up - Make Calls available on the demo stand

**Independent test**: Attach to the prepared workload, see Calls become available after checkpoint discovery, and observe nonzero counts from a repeating workload. Attach to a normal build and verify that the interface explains which target can supply the metric.

- [X] T058 [US3] Provide an opt-in repeating workload with real entry probes in `samples/Workload.Console/CallScenario.cs` and `samples/Workload.Console/Program.cs`. Document preparing and attaching the demo target in `specs/001-live-runtime-map/quickstart.md`. Check checkpoint discovery and registration in `src/CodeOrganism.Connector.DotNet/ObservationPublisher.cs` and correct failures reproduced with a prepared target. Explain unavailable Calls in `src/web/src/main.ts` and `src/web/src/language.ts`. Enable the metric from a declared calls capability and keep sampled stack appearances distinct from entry counts. See [session](data-model.md#session) (`Session.capabilities`) and [measurement](data-model.md#measurement) (`Measurement.metric`, `Measurement.value`, `Measurement.quality`).

## Phase 20: Follow-up acceptance

- [X] T059 Verify the Phase 16–19 scenarios on the packaged stand and record captures and results in `specs/001-live-runtime-map/validation/map-usability.md` and `specs/001-live-runtime-map/quickstart.md`. Reuse the existing browser suite and update assertions affected by the new presentation.

## Phase 21: US1 follow-up - Keep every observed method and expand Groups in the page

**Independent test**: Observe more than eight methods, including one with topology and no reading for the selected metric. Reduce one method's load, omit it from several intervals, collapse all groups and reconnect to the same session. The method stays in Top methods with its peak. A new higher value updates the same row. Open a deep group in normal view and scroll the page to its last descendant.

- [X] T060 [P] [US1] In `src/web/src/inspector.ts`, decouple the Top methods and Top modules selection from the expanded nodes on the map. Add an explicit selector in `src/web/index.html` and localize it in `src/web/src/language.ts`. Build Top methods from every admitted method in the session and join it to the latest `methodPeaks` for the selected metric. Keep inactive methods with their winning values and list methods without a reading as unavailable. Preserve stable ties, selection and paused data, and clear the old list only when a new session replaces it. See [session](data-model.md#session) (`Session.id`, `Session.limits`), [node](data-model.md#node) (`Node.id`, `Node.kind`), [measurement](data-model.md#measurement) (`Measurement.metric`, `Measurement.value`, `Measurement.quality`), and [view snapshot](data-model.md#view-snapshot) (`Snapshot.version`, `Snapshot.methodPeaks`).
- [X] T061 [P] [US1] Remove the Groups panel's internal height cap and scrollbar in the normal layout in `src/web/src/style.css`. Let the page grow with expanded descendants and keep long labels inside the viewport. Keep the nested hierarchy and keyboard navigation. Fullscreen panel sizing is handled in T063.

## Phase 22: US1 follow-up - Open the map fullscreen with movable panels

**Independent test**: Enter fullscreen at 1440 and 640 px with a selected method and a paused map. Move each of the three panels independently, collapse and expand them, and scroll overflowing content. The map remains navigable outside the panels. Exit using Escape and the map button. Confirm that the same panels return beneath the map with their data, selection and disclosure state.

- [X] T062 [US1] Add a localized fullscreen toggle to the lower-right corner of the map using `src/web/index.html`, `src/web/src/main.ts`, `src/web/src/style.css` and `src/web/src/language.ts`. Use the [Fullscreen API](https://fullscreen.spec.whatwg.org/) on a container that can hold the map and the information panels. Handle exit by Escape, browser state changes and rejected requests, restore focus on exit, and preserve pan, zoom, selection and pause as the canvas resizes. See [view snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).
- [X] T063 [US1] Move the same Ranking, Inspector and Groups disclosures into a fullscreen overlay and back into their original order using `src/web/index.html`, `src/web/src/main.ts`, `src/web/src/fullscreen-panels.ts`, `src/web/src/style.css` and `src/web/src/language.ts`. Give each panel its own pointer and keyboard movement control with a reachable handle in both disclosure states. Use one width and one opened height for all three panels, and one common collapsed height. Keep the content scrollable when it exceeds the available space. Clamp panel positions after moves, resizing and reopening, and preserve selection, disclosure state and map gestures outside the panels. See [view snapshot](data-model.md#view-snapshot) (`Snapshot.renderState`).

## Phase 23: US2 follow-up - Assess live memory measurements

**Independent review**: Explain which numbers are feasible per process and per module, and use a shared object to show how grouping by the defining module differs from measuring what keeps the object alive.

- [X] T064 [US2] Compare process memory metrics, managed heap snapshots and allocation/lifetime profiling in `specs/001-live-runtime-map/research.md`. Document what can be measured while the target is running, attribution rules, collection overhead and the first scope worth prototyping. See [measurement](data-model.md#measurement) (`Measurement.metric`, `Measurement.attribution`).

## Phase 24: Follow-up acceptance

- [X] T065 Verify the Phase 21–22 scenarios on the packaged build at 1440 and 640 px and record results in `specs/001-live-runtime-map/quickstart.md` and `specs/001-live-runtime-map/validation/map-usability.md`. Include keyboard entry, exit and movement, overflow in all three panels, a skipped snapshot, and a new session.

## Dependencies & Execution Order

Setup → foundation → US1 PoC → US1 product slice → US2 → US3 → release. US4's sample and contract checks may start after foundation. Finish US4 before release. Within US1, T008 and T009 can run in parallel. After the PoC gate, T013 and T014 can run in parallel. Finish the visual references before T015 implements production layout. In US2, T017 and T018 can run in parallel before integration. In US3, T021 precedes checkpoint consumption, while browser development can test the combined display using contract fixtures once US2 is stable. In US4, T025 can develop against the documented contract while T026 implements authorization.

Release requires all four stories and every acceptance matrix row. The CPU PoC alone is a distinct checkpoint. Keep future recording, multi-process views and integrations outside this task list.

### Follow-up dependencies

- T030 and T031 can run in parallel. They use the same existing graph profile and write separate reports. T032 needs the layout decision from T031. Collect the renderer baseline from T030 before changing the browser code.
- Complete T032–T035 before adding the remaining workspace changes in T036–T038. Run T033 and T034 in sequence because both change pointer behavior in `src/web/src/graph/map.ts`. Run T036–T038 in sequence because they share workspace markup and UI state.
- T039 uses the hover behavior from T033. T040 uses the disclosure and overlay behavior from T037–T038. T041 measures the completed visuals against T030, and T042 validates the integrated result.

### Follow-up implementation strategy

1. Record the renderer baseline and choose the layout approach in Phase 8.
2. Deliver Phase 9 as the first usable increment, then verify navigation and layout at both widths.
3. Deliver the stable workspace and visual transitions in Phases 10–11, then profile and validate the integrated build in Phase 12.

### Workspace and graphics follow-up

- Deliver T043–T045 as the first usable increment. The graphics preset definitions in T048 can be prepared in parallel because they only touch `src/web/src/settings.ts`.
- Complete T046 before T047 so the zoom work can use the revised geometry. Apply effects in T049 after T046–T048 so the renderer uses the final navigation and preset definitions.
- Run T050 after both stories are ready. The renderer evaluation is already available in [the report](validation/renderer-direction.md).

### Visual design and inspection follow-up

- T052 and T054 can start independently. T053 uses the confirmed effects from T051 and the relationship view approved after T052.
- T055 uses the snapshot summary from T054. Run T055, T056 and T057 in sequence because they share Inspector rendering and localization. Coordinate T058 with them where it touches translations and the quickstart.
- Deliver peak ranking, nested Groups, the shorter Inspector and the Calls demo as the first usable increment while the user reviews visual alternatives. Apply the approved map changes next, then run T059 on the packaged result.

### Fullscreen and persistent ranking follow-up

- T060 and T061 can run in parallel because the ranking change and the normal Groups layout touch separate files. The research in T064 is independent of UI work.
- Complete T060 and T061 before T062 and T063 integrate fullscreen with the existing panels. T062 provides the fullscreen container and lifecycle used by T063.
- Ship stable Top methods and page-height Groups as the first increment. Add the fullscreen map and movable panels next. Run T065 after both increments are integrated.
