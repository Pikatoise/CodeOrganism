# Feature Specification: Live Runtime Map

**Feature directory**: `001-live-runtime-map`  
**Created**: 2026-11-27  
**Status**: Confirmed product scope  
**Input**: CodeOrganism's six-round product discussion and [original context](../../docs/CodeOrganism_context.md).

## User Scenarios & Testing

### User Story 1 - Find the source of CPU load (P1)

A developer opens the local visualizer in a browser, attaches to a running supported application, and finds the code behind a change in CPU load. This is the primary diagnostic workflow.

**Independent test**: Attach to a running workload with a known busy method and a long-waiting method. Identify the busy method from the map and inspector.

1. **Given** an eligible running process, **when** the developer attaches and triggers a workload, **then** the relevant module and method become visible, and CPU activity pulses.
2. **Given** a populated map, **when** the developer expands a module or selects a leader, **then** the map focuses the corresponding node and the inspector describes its measurement.
3. **Given** a visible spike, **when** the developer pauses, **then** the map and measurements stay fixed and navigable. Resuming shows the current live state.

### User Story 2 - Find allocation hotspots (P2)

A developer switches to allocation rate to find code allocating the most memory during a workload.

**Independent test**: Switch to allocation rate while a known method increases managed allocations. Check the node, ranking and stated measurement method.

1. **Given** allocation data, **when** allocations rise in a known method, **then** its allocation rate and visual size increase.
2. **Given** an estimated allocation rate, **when** the developer opens the inspector, **then** it labels the estimate and shows the allocation-rate unit.

### User Story 3 - Inspect method frequency and compare signals (P3)

A developer uses call frequency to understand which supported methods run most often, then checks how frequency relates to CPU and allocation rate.

**Independent test**: Run a prepared target that invokes a known method a controlled number of times. Verify the interval count and switch between individual and combined views.

1. **Given** an instrumented method with a known number of entries, **when** the corresponding interval is inspected, **then** its count matches the controlled total and its rate drives glow.
2. **Given** a source publishing all three measurements, **when** the developer selects the combined view, **then** pulse, node size and glow convey their respective values independently.

### User Story 4 - Publish from another connector (P4)

A connector author sends an observed graph and a supported metric to the same input as the first connector.

**Independent test**: Send a small graph and call-frequency data using the documented example without starting the first connector.

1. **Given** a compatible publisher exposing just one metric, **when** it sends a graph and measurements, **then** the map displays them and marks the other metrics unavailable.
2. **Given** an incompatible version or a second candidate source for an active session, **when** the publisher attempts to connect, **then** it receives an actionable response and the current session is unaffected.

### Edge Cases

- Missing source files or debug symbols still permit attach. Unresolved frames have stable labels within the session where an identity is available.
- Access denied, disabled diagnostics, unsupported targets and targets that exit during attach produce actionable states. Detaching leaves the target running.
- Idle windows, missing measurements and dropped telemetry are distinct. A known incomplete interval is marked even while its available values are shown.
- A slow browser can skip display updates and recover to current state. Pausing never creates an unbounded history.
- Recursion and background execution may produce loops and disconnected branches. The map preserves their observed relationships.

## Requirements

### Functional Requirements

- **FR-001**: Provide a fully local browser workflow with one active session and one source. The first connector MUST support attach to eligible running modern .NET applications on Windows and detach without terminating them.
- **FR-002**: Provide a documented, open, versioned data contract and example that support third-party connectors and partial metric capabilities. The first connector MUST use this same data entry point.
- **FR-003**: Build an organic 2D map from observed execution. Distinguish observed neighboring stack frames from instrumented call relationships. Expand modules to methods and allow library groups to be inspected.
- **FR-004**: Keep discovered topology available throughout a session. Use gradual visual decay after spikes and keep positions stable during metric-only updates.
- **FR-005**: Show CPU attributed to code, estimated managed allocation rate, and method entry count and rate for the scope of the supported exact mode. A stack appearance count cannot serve as CPU time or method entry count.
- **FR-006**: Map CPU to pulse, allocation rate to node size and call rate to glow. Allow individual views and a combined view. Provide text values and a legend for interpretation.
- **FR-007**: Provide a ranked view by available metric, selection shared with the map, and a collapsible inspector with values, units, time window, measurement method, coverage and data quality.
- **FR-008**: Pause and navigate a fixed snapshot while collection continues. Resume at the current live state. Provide a separate detach control.
- **FR-009**: Keep captured telemetry in memory. Show source state and mark known measurement loss. Distinguish unavailable readings, zero values and approximate or exact readings.
- **FR-010**: Publish CodeOrganism under MIT with local usage and connector documentation.

### Key Entities

- **Session**: One attached target or connector source and its lifecycle.
- **Node**: A module, a method, or an explicitly unresolved bucket.
- **Relationship**: A directed observed stack adjacency or instrumented caller-to-callee observation.
- **Measurement**: A metric value for a target and interval with units, method, coverage and quality.
- **View snapshot**: Topology, measurements and availability at a specific point in the session.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In the PoC, a live target produces an on-screen graph through the connector boundary. The known busy method ranks above a deliberately waiting method in the CPU acceptance workload. Stack-only observation can document an experiment but cannot pass this gate.
- **SC-002**: On the agreed workload, median elapsed time increases by at most 10% in CPU-only mode and each measured load change becomes visible within 2 seconds in the agreed normal load profile.
- **SC-003**: The controlled allocation method rises in rank and displayed allocation rate when its allocation volume increases. The exact mode reports the known method entry total on the supported controlled workload.
- **SC-004**: A reviewer verifies module overview, expanded spike and combined metric states at full and side-by-side widths. The reviewer can identify the active branch and explain each visible metric using the interface.
- **SC-005**: The sample third-party connector renders one available metric and clearly communicates the two missing ones using the public contract alone.

## Assumptions

- The PoC is a CPU-first feasibility checkpoint. The MVP includes the remaining two metrics in order: allocations, then method calls.
- Recording, replay, comparison, export, IDE integration, multi-process maps, additional platforms, and static analysis are future scope.
- Compatibility, benchmark profile and exact-mode overhead are qualified with the experiments in the [technical plan](plan.md).
