# Data Model: Live Runtime Map

The [connector contract](contracts/connector-v1.md) specifies transport and the examples. These rules apply equally to all connectors.

## Session

- `Session.id`: Host-issued opaque identifier. Namespaces all node, edge and interval identities. A client retry with the same source and request ID returns the same session.
- `Session.source`: Stable producer ID, display name and optional target description. The .NET connector verifies PID plus start time internally.
- `Session.state`: Connecting → live → ended or failed. Stale is a live-state indicator derived from update age. One connecting or live session can own the map. A completed map can remain visible until the user clears or replaces it.
- `Session.capabilities`: Per-metric declaration of method, units and quality. A source may declare a non-empty subset of CPU, allocated bytes and method entries. If exact mode is absent, method entries are unavailable.
- `Session.limits`: Host returns negotiated size, batch and cadence limits. If topology capacity is reached, stop admitting new identities and report truncation. Preserve admitted identities, attribute new observations to a reserved unresolved bucket where possible, and distinguish truncation from zero activity.

## Node

- `Node.id`: Opaque and stable within a session. Upserts may enrich labels but cannot change kind or parent. .NET handles overload and module-load identity inside its connector.
- `Node.kind`: Module, method or unresolved. Methods have one module parent. Unresolved may belong to a module when known, or be unparented. Parent IDs must already exist or be admitted in the same batch.
- `Node.label`: Display as text. Initial unresolved labels may become method names when the connector resolves an already-known method identity. The unresolved bucket remains explicitly unresolved.
- `Node.library`: Optional source/framework/third-party classification for module presentation. Unknown classification is allowed.

## Relationship

- `Relationship.identity`: Ordered source node, target node and evidence tuple. Endpoints exist in the same session. Self-edges are valid. Evidence is `stack-adjacency` or `instrumented-call`. Entry totals alone cannot create instrumented-call edges.

## Measurement

- `Measurement.interval`: Source-relative elapsed milliseconds, half-open `[startMs, endMs)`. Each accepted batch advances to a new, nonoverlapping interval. A source declares a gap with incomplete quality. Measurements in one batch use its interval.
- `Measurement.metric`: `cpu` (sample-weighted CPU milliseconds), `allocation` (estimated bytes), or `calls` (entry count). Rates are derived from the interval: allocation bytes/s and calls/s. Use CPU milliseconds per second for comparisons across window durations.
- `Measurement.value`: Non-negative finite number or null. Calls are safe integer counts. A reported zero requires coverage evidence. Null means unavailable.
- `Measurement.quality`: `estimated`, `exact`, or `unavailable`. Preserve separate `complete` coverage for the interval and a method label describing provenance. An exact-mode value with an incomplete interval describes only covered data. Never display it as an exact total for that interval.
- `Measurement.attribution`: For CPU and allocation use exclusive attribution to the resolved executing or allocating frame. Separate unresolved or native work where the connector has an observation but no attributable managed method. Module totals sum exclusive covered descendants once. For calls use method-entry counts grouped over instrumented descendants. Surface partial coverage and unknown attribution in rollups.
- `Measurement.loss`: Known measurement loss, mapping or topology truncation is reported in bounded categories. Time gaps remain incomplete even when later batches resume.

## View snapshot

- `Snapshot.version`: Monotonic per session. Carries admitted topology, measurements, source state and loss indicators. SSE can skip intermediate versions. Resume and reconnect request the latest complete snapshot.
- `Snapshot.methodPeaks`: The host keeps one winning reading and its interval per admitted method and metric in the session. Compare rates across window lengths. Keep the first reading on ties. For calls, prefer complete rates and retain the largest covered count until a complete reading arrives. Missing values leave the stored peak in place. The latest snapshot carries the summary even when a browser skips updates. A new session starts with an empty summary.
- `Snapshot.renderState`: Browser-only position, focus, filter, selection, animation phase and paused snapshot. Decay changes visual emphasis only. Exact values in the inspector stay tied to their measured windows.
