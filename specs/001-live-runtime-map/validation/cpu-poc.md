# CPU PoC Acceptance

**Run date**: 2026-11-27

**Result**: Passed on the control profile below.

## Control profile

- Windows 11 Pro x64, build 28000, AMD Ryzen 5 5500U, 12 logical processors.
- .NET SDK 10.0.404. Release console workload, one target and one active local browser session. Microsoft Edge 158.0.4370.45, 1440 × 900 for latency observations.
- Two methods alternate three-second compute phases alongside a separate waiting thread. ETW samples at a 1 ms interval. The connector publishes via the documented v1 entry point at a 200 ms target cadence. Browser snapshots use SSE.
- ETW capture was verified from an elevated test session. Browser-initiated attachment and collector isolation are production-slice work.

## Live graph and latency

The enabled connector attached after both methods had executed. The browser drew the runtime map and displayed the expected CPU leader. Separate ETW verification found no on-CPU sample for the waiting method and resolved observed stack links to both busy methods. See [Windows ETW spike](cpu-etw-spike.md).

Match the workload's UTC phase marker to the first browser ranking update with the expected leader. Count the update after two animation frames. This approach includes event dispatch, collection, ingress, browser delivery and a render opportunity.

| Observed change | Elapsed |
|---|---:|
| BusyBeta present on initial attachment | 1,977 ms |
| BusyAlpha takes the lead | 1,710 ms |
| BusyBeta takes the lead | 1,710 ms |
| BusyAlpha takes the lead again | 1,710 ms |

The four observed updates were inside the 2,000 ms target. The map also rendered at 640 px without horizontal overflow.

## Paired overhead

Run the warm console fixture using `--benchmark 6500 --pipe`. Send `run` on stdin for each trial. Compare elapsed time with the collector off and with a three-second CPU connector session active through the host while the browser is open. Start observed trials 1.3 seconds after launching the connector. Alternate trial order. Keep the same fixture process for all trials.

| Pair | Baseline ms | Capture ms |
|---|---:|---:|
| 1 | 428.52 | 336.13 |
| 2 | 400.93 | 405.70 |
| 3 | 399.93 | 408.45 |
| 4 | 401.98 | 405.94 |
| 5 | 398.69 | 404.34 |
| 6 | 398.49 | 407.07 |
| 7 | 397.70 | 406.93 |
| 8 | 397.26 | 406.46 |
| 9 | 400.27 | 407.77 |
| 10 | 399.16 | 404.22 |

Median paired overhead was **1.64%**, inside the 10% target. Keep the first pair in the calculation despite the variation. No kernel loss was reported in these runs.

## Render-only scale sweep

A synthetic publisher sent 12 modules and progressively larger graphs through the same contract. The largest single check drew 1,000 methods and 3,000 relationships. This measures frame pacing for a loaded map over 1.8 seconds at 1440 × 900. It does not measure render cost under a continuously changing topology.

| Methods | Relationships | p95 frame interval |
|---:|---:|---:|
| 250 | 750 | 33.3 ms |
| 500 | 1,500 | 17.0 ms |
| 1,000 | 3,000 | 17.0 ms |

Use the 12-module, 250-method, 750-relationship fixture as the next visual baseline. The real-target latency qualification applies to the console control profile above. A general application-size or latency guarantee requires release validation.
