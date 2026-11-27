# Exact Call Probe Validation

Windows 11 Pro x64 build 28000, AMD Ryzen 5 5500U, .NET 10.0.15 runtime, .NET SDK 11.0.100 and Microsoft Edge 158.0.4370.45. All fixtures used Release builds.

## Qualified scope

Use one `EntryCounters` instance per process. Register selected, non-generic synchronous managed methods and call the returned counter's `Enter()` as the first action in each method. Register before starting the workload. The checkpoint covers every registered counter at the same boundary. The collector discovers the provider at attach and uses its first checkpoint as the baseline. The count describes entries, including recursion and entries that throw. An uninstrumented method has no count.

Use the prepared console fixture from the repository root. The output path keeps the prepared build separate from the default build.

```powershell
$probeArtifacts = Join-Path $env:TEMP 'codeorganism-call-validation'
dotnet build samples/Workload.Console -c Release -p:EnableCallProbes=true --artifacts-path $probeArtifacts
$env:CODEORGANISM_TEST_CALL_TARGET = Join-Path $probeArtifacts 'bin/Workload.Console/release/Workload.Console.dll'
dotnet test tests/CodeOrganism.Windows.Tests -c Release --filter FullyQualifiedName~CallProbeTests
$env:CODEORGANISM_TEST_ETW = '1'
npm.cmd --prefix tests/browser test -- combined-map.spec.ts
```

Run the tests from an elevated Windows shell for ETW. To try the fixture interactively, run `dotnet $env:CODEORGANISM_TEST_CALL_TARGET --calls`. Attach in the browser, wait for the Calls tab, and enter a positive loop count in the fixture's terminal. An empty line exits the fixture.

## Counts and coverage

The test warmed the fixture with 1,000 iterations per worker before attach, waited for a complete zero-delta window, then ran 50,000 iterations on each of four workers. Complete published windows summed to the reference counts below.

| Method | Reference | Observed |
|---|---:|---:|
| `ConcurrentEntry` | 200,000 | 200,000 |
| `RecursiveEntry` | 600,000 | 600,000 |
| `ThrowingEntry` | 2,000 | 2,000 |

A deterministic replay verified an unavailable first boundary, a complete delta, a missed checkpoint, a partial recovery window and a complete zero. A zero from a partial window remains unavailable on the wire. The combined browser tests at 1440 and 640 px checked each ranking metric, visible channel labels, rendered call glow and partial-count wording.

## Probe cost

Run the same `--calls` workload in two warm processes, one with `EnableCallProbes=true` and one with the default build. Enable the allocation and checkpoint providers through EventPipe on both. Send `50000` once per trial, which covers four workers and 802,000 instrumented entries in the prepared build. Use three warmups per process, alternate order across ten pairs, and compare the fixture's reported `elapsedMs`. The measurement covers the workload itself with EventPipe active.

| Pair | Default ms | Prepared ms |
|---|---:|---:|
| 1 | 3.02 | 41.48 |
| 2 | 3.41 | 34.42 |
| 3 | 17.46 | 38.92 |
| 4 | 9.38 | 38.07 |
| 5 | 5.71 | 29.32 |
| 6 | 3.93 | 37.04 |
| 7 | 3.80 | 14.29 |
| 8 | 3.22 | 10.16 |
| 9 | 3.32 | 10.27 |
| 10 | 3.74 | 20.25 |

Median paired overhead was **359.48%** in this short, entry-heavy workload. This run qualifies count correctness for the controlled fixture. Treat the measured cost as a constraint on the number and frequency of methods selected for exact counting.
