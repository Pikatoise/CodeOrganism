# Allocation Rate Acceptance

The .NET connector reads EventPipe allocation ticks and attributes their weighted bytes to the resolved managed frame. CPU and allocation records share the same node identity and measurement windows. An unresolved frame contributes to a separate allocation bucket. A window without a sample for a method has an unavailable value. The browser uses an explicit zero only when a source reports one.

## Reproduce

Build the solution and browser assets in Release. Open the local host and start the fixture:

```powershell
dotnet run --project samples/Workload.Console -c Release -- --allocations
```

Attach to the fixture PID, select **Allocations**, and expand the fixture module. The ranking should alternate between `AllocateOrders` and `AllocateInvoices`. Each method alternates between allocating 128 arrays and allocating four arrays per burst, and the fixture independently reports per-thread allocated-byte deltas.

## Qualification

- Windows x64 integration verifies that the measured per-thread reference rises by more than 20 times between the heavy and light phases. EventPipe ranks the expected method first in multiple windows for each heavy phase. This verifies direction and attribution. Sample counts and exact totals vary with runtime allocation sampling.
- A deterministic ingestion check covers weighted bytes, shared CPU and allocation node identity, unattributed records, loss during collection and missing measurements.
- Playwright verifies the live browser ranking with the ETW worker and EventPipe. The synthetic publisher check verifies node-size growth, bytes-per-second formatting, estimate labels, the distinction between zero and unavailable, and metric-specific loss text.
- A 68-second browser-control session emitted named allocation measurements before and after the one-minute EventPipe rotation. One interval carried an allocation-loss marker during the run. A separate test verifies that terminating the target preserves the process-exited state when the EventPipe stream ends in a partial block.
- The UI displays estimated managed bytes allocated over time. It provides no live-heap or surviving-object measurement.
