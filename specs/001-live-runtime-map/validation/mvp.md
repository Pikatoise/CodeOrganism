# Live Runtime Map MVP Validation

Run date: 2026-11-28. Windows 11 Pro x64 build 28000, AMD Ryzen 5 5500U, .NET 10.0.15 runtime, .NET SDK 11.0.100, Node.js 26.8.1, Microsoft Edge 158.0.4370.45. Release builds throughout. The test runner used an elevated Windows session for automated ETW capture.

The final run passed 29 .NET tests and all 11 Playwright tests against the published package.

## Acceptance matrix

| Scenario | Result |
|---|---|
| CPU live and truthful | A warm console target ranked both alternating managed methods. The elevated integration test verified the waiting control and name resolution without PDBs. The buffer test verified unresolved CPU. A warm ASP.NET Core fixture also ranked a named method. The published UI used the common connector endpoint. [CPU PoC](cpu-poc.md) |
| CPU speed and cost | Four live transitions took 1,870–1,887 ms. Ten CPU-only paired trials gave 2.19% median elapsed overhead. Both met SC-002 on the measured profile. |
| Allocation rate | Windows and browser tests followed both heavy/light phases. The checks covered weighted bytes against per-thread reference direction, unresolved work, estimates and missing versus covered zero readings. [Allocation validation](allocations.md) |
| Exact calls | Complete windows contained 200,000 ordinary, 600,000 recursive and 2,000 throwing entries. The test covered concurrent entry, initial and missing checkpoints, partial recovery and a covered zero. The live browser showed call rates through the first-party connector. [Call probe validation](call-probes.md) |
| UI and pause | Playwright verified ranking, grouping, selection, keyboard controls, pause and recovery, metric channels, reduced motion and no horizontal overflow at 1440 and 640 px. [Reference states](design/README.md), [combined map at 1440 px](mvp-captures/combined-1440.png), [combined map at 640 px](mvp-captures/combined-640.png) |
| Open connector | The PowerShell example ran through the published host and displayed only calls. It received the expected responses for an invalid credential, an incompatible version and an occupied session. Its producer credential was rejected by the browser-control endpoint. |
| Failure paths | The Windows launch test supplied the results for access denied and a cancelled elevation. Live checks exercised disabled diagnostics, exit and detach. Store tests exercised rate limits, topology limits, measurement loss and a slow reader recovering the latest snapshot. The collectors use in-memory ETW and EventPipe sessions. |
| Offline distribution | The Windows x64 package started with the working directory outside the checkout. With all page requests outside its loopback origin blocked, Edge loaded local JS and CSS, discovered a running .NET target, attached, ranked a managed method and detached. The package included both license files. |

## CPU performance

The latency run used the published host, one Edge tab at 1440 × 900, and the warmed console fixture alternating three-second phases. It measured from each UTC phase marker to the first matching leader after two browser animation frames. This run measured steady-state transitions after attach.

| Transition | Elapsed ms |
|---|---:|
| `BusyBeta` | 1,887 |
| `BusyAlpha` | 1,870 |
| `BusyBeta` | 1,886 |
| `BusyAlpha` | 1,871 |

The cost run used the same warm process for ten alternating pairs. Each trial executed `--benchmark 6500 --pipe`. For the observed trial, the published connector sent CPU-only measurements to the host and the workload began 1.3 seconds after collector launch. The browser stayed open.

| Pair | Baseline ms | CPU capture ms |
|---|---:|---:|
| 1 | 332.90 | 337.60 |
| 2 | 397.08 | 422.33 |
| 3 | 395.75 | 404.39 |
| 4 | 394.61 | 407.29 |
| 5 | 391.71 | 400.78 |
| 6 | 398.62 | 403.44 |
| 7 | 399.52 | 405.26 |
| 8 | 399.07 | 411.03 |
| 9 | 391.44 | 400.04 |
| 10 | 403.38 | 405.35 |

The median of the ten paired ratios was **2.19% overhead**. The CPU limit applies to this CPU-only profile. Prepared call probes added **359.48% median overhead** on the separate 802,000-entry stress workload with EventPipe active. The render-scale sweep for 12 modules and up to 1,000 methods remains documented in the [CPU PoC](cpu-poc.md#render-only-scale-sweep).

## Verification limits

The elevation tests covered Windows error handling with supplied launch errors in an elevated test shell. The native interactive UAC dialog was outside this run. The offline test blocked browser requests outside loopback and exercised real diagnostics using the installed ASP.NET Core 10 Runtime. The test machine kept its network connection.
