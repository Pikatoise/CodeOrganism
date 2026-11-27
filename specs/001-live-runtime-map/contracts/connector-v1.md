# Connector Ingestion Contract v1

[Entity and validation rules](../data-model.md) are normative. All routes use HTTP on the host-provided IPv4 loopback origin. The host supplies the producer with an ephemeral bearer credential out of band. Pass it in the Authorization header. Send JSON, valid UTF-8, and no executable markup. Keep credentials out of URLs and logs.

## Lifecycle

| Method and path | Request and response |
|---|---|
| `POST /api/connector/v1/sessions` | Register via `requestId`, `version` (integer 1), `source` and `capabilities`. Returns 201 with `sessionId` and `limits`. Same-ID retry with the same payload returns the same result while the session exists. |
| `POST /api/connector/v1/sessions/{sessionId}/batches` | Send one topology and measurement interval. Returns 202 after validating and atomically admitting the batch. |
| `POST /api/connector/v1/sessions/{sessionId}/end` | End with a typed reason (`detached`, `target-exited`, `producer-error`). Repeated end is idempotent. |

A new source receives 409 `session-in-use` while a source is active. Errors use `{ "code": "...", "message": "..." }`. Use 400 for invalid payload, 401/403 for invalid access, 404 for unknown session, 409 for incompatible versions or conflicts, 413 for oversized body and 429 for retryable overload. HTTP failures must not partially apply a batch. The host expires a silent source after its advertised inactivity bound. Browser detach ends its displayed session and stops a first-party collector without terminating the target.

## Example

Registration request:

```json
{
  "requestId": "62ae266b-d704-45c0-a029-096efbfbc8ea",
  "version": 1,
  "source": { "id": "fixture", "label": "Sample connector" },
  "capabilities": [{ "metric": "calls", "unit": "count", "method": "entry-counter", "quality": "exact" }]
}
```

First batch:

```json
{
  "sequence": 1,
  "startMs": 0,
  "endMs": 1000,
  "nodes": [
    { "id": "orders", "kind": "module", "label": "Orders" },
    { "id": "run", "kind": "method", "parentId": "orders", "label": "Run" }
  ],
  "relationships": [],
  "measurements": [
    { "nodeId": "run", "metric": "calls", "value": 12, "quality": "exact", "complete": true }
  ],
  "loss": []
}
```

Units are `ms` for CPU, `byte` for allocations and `count` for calls. Publish no more than one measurement per metric/node/interval. Omitted unsupported metrics are unavailable. Omitted measurements for a supported metric are unavailable unless explicitly published as zero. Loss entries carry `kind` (`source-events`, `source-gap`, `unresolved-attribution` or `topology-limit`) with optional affected metric and known count.

Sequence starts at 1 and increases per source. Retrying the latest accepted sequence with the same batch is idempotent. A conflicting replay is rejected. Following overload, retry the unaccepted batch within the producer's bounded queue. If it must be dropped, skip its sequence and report the resulting gap on the next accepted batch. An exact cumulative interval may span missed checkpoints only when coverage and endpoints are both known. Do not split such a count into fabricated shorter windows.

## Local boundaries

Bind explicitly to `127.0.0.1`, validate the actual Host authority, and reject cross-origin mutations. Protect browser control with a per-launch UI session and same-origin anti-CSRF mechanism. Producer credentials cannot issue browser control commands. The browser gets latest accepted full snapshots over same-origin SSE. Browser snapshots never include ingress credentials or raw diagnostic events. Distribute the producer endpoint and credential over a local process-owned channel for first-party connectors. The operator can authorize a third-party connector explicitly.
