# Map follow-up acceptance

The Windows x64 package was exercised on Windows 11 Pro build 28000 with Edge 158.0.4370.45. The browser scenarios use 1440 × 900 and 640 × 900 viewports. At each width the follow-up tests run in normal and reduced motion. The live Windows tests exercise real ETW, EventPipe, the optional call probes and offline use. The follow-up tests use deterministic snapshots and attach responses to cover timing and failure paths.

All 29 .NET tests and 19 Playwright tests passed. The four navigation cases also passed with Canvas, rasterization and compositing in software mode. The package loaded and attached outside the repository with requests outside loopback blocked.

| Scenario | Result |
|---|---|
| Layout | The dense fixture's edge crossings dropped from 24,975 to 2,288. Mean endpoint distance dropped from 256 to 94 CSS px at 1440 and from 163 to 66 CSS px at 640. Reordered input, metric updates and collapse/re-expansion preserved coordinates. A topology update moved each existing node by at most 47 CSS px at 1440 and 27 CSS px at 640, at the default zoom. [Layout audit](map-layout.md) |
| Navigation | The baseline required a wheel modifier and zoomed about the canvas center. The current map zooms beneath the pointer, emphasizes the nearest branch and both endpoints, and clears hover on drag. The self-loop and its node remained independently targetable. Collapse all hid the expanded methods in one action, lifted the selection to its module, kept the current zoom, and moved keyboard focus to the map. Hover, zoom and collapse also worked while paused. |
| Stable workspace | Long source labels, changing coverage messages and rank updates kept canvas bounds stable. The list retained its scroll position and keyboard focus across a rank change. Ranking and Groups opened by keyboard, retained their disclosure states, and restored the selected combined ranking metric after switching modes. |
| Attach | Attach made the map and inspector inert during the request. The previous session's live snapshot could not unlock them, even with the same PID. A matching new live snapshot released the workspace and restored focus. Request rejection, denied elevation, target exit and stream loss released it. Detach remained available once the host reported an active request. |
| Activity | The CPU branch kept its quiet core as its purple activity rose and faded. The cyan call-rate halo remained separate in Combined. Pause preserved the canvas activity phase and the displayed measurement while new snapshots arrived. The reduced-motion view used static activity emphasis and omitted animated interface transitions. |
| Dense software view | All 750 branches retained a core. The halo budget emphasized up to 96 branches at once. The map kept selected and group labels ahead of method labels. It shortened long labels and omitted colliding labels. Zoom or the inspector exposed details that did not fit at overview scale. [Renderer measurements](render-performance.md) |

## Captures

| Viewport | Normal motion | Reduced motion | Dense software rendering |
|---|---|---|---|
| 1440 px | [Paused Combined](map-usability-captures/expanded-1440-no-preference.png) | [Paused Combined](map-usability-captures/expanded-1440-reduce.png) | [CPU fixture](map-usability-captures/software-1440.png) |
| 640 px | [Paused Combined](map-usability-captures/expanded-640-no-preference.png) | [Paused Combined](map-usability-captures/expanded-640-reduce.png) | [CPU fixture](map-usability-captures/software-640.png) |

Run the [quickstart](../quickstart.md) against the packaged build. Set `CODEORGANISM_TEST_SOFTWARE=1` to rerun the follow-up tests with hardware acceleration disabled. The denial test supplies the host's typed access restriction and the existing Windows checks exercise privilege and process errors. The interactive Windows elevation prompt is outside these browser tests.

## Full-width workspace and graphics presets

All 29 .NET tests and all 20 Playwright tests passed. The updated Windows x64 bundle passed real ETW and EventPipe attach, exact call probes and offline use. The navigation cases use the packaged assets with deterministic snapshots at 1440 × 900 and 640 × 900, in normal and reduced motion. All four navigation cases also passed with hardware acceleration disabled.

| Scenario | Result |
|---|---|
| Workspace and process list | Map and inspection area share the workspace width. The three disclosures appear below the map, and long lists scroll independently. Enter activates the refresh button next to the selector, the button indicates loading, and the process selection survives refresh. The button has a localized label and tooltip. |
| Disclosure state | Node and branch selection update the Inspector without opening it. Closing ranking hides coverage and loss, and reopening it reveals messages from the latest snapshot. Live updates preserve the map bounds and list focus and scroll. |
| Branches and zoom | Reciprocal curves go to opposite sides of the endpoint chord. A loop can be hovered or selected separately from its node. It remains selectable at both 7.78% and 2474.87%. Wheel zoom keeps its pointer anchor. The field tracks wheel, keyboard, buttons and Reset view. It accepts decimal percentages on Enter or blur and restores the last applied value after invalid input. |
| Graphics | Low, Balanced and High apply to the paused map immediately. The browser checks halo widths of 3, 8 and 22 CSS px and backing scales of 1×, 2× and 3× on an emulated DPR 3 display. Paused snapshots retain their activity. The tests also exercise theme changes, reduced motion and the separate metric channels. [Dense fixture results](render-performance.md) |

Packaged captures show the workspace and reciprocal branches at [1440 px](map-usability-captures/workspace-1440.png) and [640 px](map-usability-captures/workspace-640.png).

## Immediate neighborhood and peak ranking

The user chose view B from the [relationship comparison](relationship-views.md). The map holds the graph in place, dims unrelated links and emphasizes the nearest links at both endpoints of the hovered or selected branch. The chosen branch carries a direction marker.

The renderer uses a weighted recent baseline for each node and metric. The current tuning treats a positive reading as a new spike when it exceeds both the baseline by 30% and the last reading by 15%. A positive reading after measured zero lights up even below those thresholds. Low holds the highlight for 1.4 seconds. Balanced and High fade the highlight over that interval. The OS motion preference still controls interface transitions outside the map.

The host keeps method peaks from accepted batches. The latest snapshot carries them even after a skipped update, and the browser keeps current readings in the Inspector. Groups renders visible children under their parent, including library modules and methods, while its disclosure heading matches Ranking and Inspector. The prepared Calls demo alternates two call loads without terminal input.

The Windows x64 package passed all 22 browser tests. The .NET suite passed all 30 tests. The browser run exercised real CPU and allocation attach, exact call discovery for both call demo modes, offline distribution, and the zero-to-positive effect under the OS reduced-motion preference. Navigation passed at both widths.

| Viewport | Branch neighborhood | Peak ranking and nested Groups |
|---|---|---|
| 1440 px | [Canvas](map-usability-captures/neighborhood-1440.png) | [Workspace](map-usability-captures/peak-ranking-1440.png) |
| 640 px | [Canvas](map-usability-captures/neighborhood-640.png) | [Workspace](map-usability-captures/peak-ranking-640.png) |

## Persistent ranking and fullscreen panels

The Windows x64 package passed all 24 Playwright tests and the solution passed all 30 .NET tests. At 1440 and 640 px, the ranking retained all 15 fixture methods when the map collapsed and the stream skipped snapshots. A higher peak updated its row, a method without a reading remained visible, and replacing the session cleared the previous rows. Expanded Groups used page scrolling in the normal layout.

Fullscreen opened from the keyboard and closed with Escape or the map button. The panels moved independently using pointer and keyboard controls. The tests checked matching sizes in open and closed states, scrolling in each opened panel, wheel zoom outside the panels, and restoration of focus, selection, pause and disclosure state on exit. A rejected fullscreen request left the panels in the page and displayed a status message.

The overflow fixture includes an unusually long method name to exercise Inspector scrolling. [1440 px capture](map-usability-captures/fullscreen-1440.png) · [640 px capture](map-usability-captures/fullscreen-640.png)
