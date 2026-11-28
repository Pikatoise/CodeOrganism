# Render performance

Baseline: Windows 11 Pro build 28000, Edge 158.0.4370.45, AMD Radeon Graphics driver 31.0.21925.1001. Display 2560 × 1600 at 60 Hz, device pixel ratio 2. One focused tab ran at 1440 × 900 or 640 × 900 CSS px in a maximized window. Canvas sizes were 1040 × 549 and 591 × 450 CSS px.

| Edge profile | Canvas | Rasterization | Compositing |
|---|---|---|---|
| Default | Hardware accelerated | Hardware accelerated | Hardware accelerated |
| `--disable-gpu --disable-gpu-compositing` | Software only | Software only | Software only |

Verified in `edge://gpu` in separate temporary profiles with the same launch flags.

## Procedure and budget

Install the browser test dependencies, build the web app and run the foreground profiler from the repository root. The baseline used revision `26f6bc1`. Set `MAP_PROFILE_BASELINE=1` for that version so wheel events use the original zoom modifier. The profiler writes metrics, Edge graphics status and DevTools traces to its output directory.

```powershell
npm.cmd --prefix tests/browser ci
npm.cmd --prefix src/web run build
node tests/browser/profile-map.mjs src/web/coverage/map-profile
```

Set `MAP_PROFILE_ASSETS` to the packaged `wwwroot` directory to repeat the release run. Set `MAP_PROFILE_OFFSCREEN=1` to repeat the comparison. That variant draws into an `OffscreenCanvas` at the same backing resolution and copies the surface into the displayed canvas each time the map draws. It uses the same layout, foreground profiles, input and snapshot cadence.

All runs use the same 12 modules, 250 visible methods and 750 relationships. Each phase samples five seconds. Idle uses settled zero measurements. Live, wheel and pan update measurements at 1 Hz. Wheel alternates ±100 px, and pan follows a repeating path. Slow browser dispatch reduces the number of deliverable inputs.

Target frame interval p95 within 1.1 × 1000 / Hz (18.3 ms at 60 Hz), fewer than 5% missed refreshes, no main-thread tasks over 50 ms, and input-to-render p95 within three refreshes (50 ms at 60 Hz). Apply the same frame budget to both profiles and check software interaction separately.

## Baseline metrics

CPU sums Edge process CPU times and divides by elapsed time. 100% is one logical core. Missed refreshes are estimated from consecutive animation-frame intervals. Input latency runs from the earliest delivered wheel or drag event to the animation callback following the canvas draw. This measures a paint opportunity and includes an extra refresh in the steady case. Scanout and inputs dropped before DOM delivery are outside that measurement. Long tasks are given as count / maximum ms.

| Profile | Width | Phase | Frame p50/p95 (ms) | Missed | Long tasks | CPU % | Input p95 (ms) / n |
|---|---:|---|---:|---:|---:|---:|---:|
| GPU | 1440 | Idle | 16.7 / 17.0 | 0 | 0 | 156.8 | |
| GPU | 1440 | Live | 267.0 / 1483.7 | 286 | 0 | 60.8 | |
| GPU | 1440 | Wheel | 283.5 / 383.2 | 309 | 0 | 55.1 | 1178.4 / 5 |
| GPU | 1440 | Pan | 266.6 / 333.3 | 277 | 0 | 60.5 | 1138.1 / 18 |
| GPU | 640 | Idle | 16.7 / 17.0 | 0 | 0 | 135.3 | |
| GPU | 640 | Live | 166.6 / 433.2 | 285 | 0 | 68.3 | |
| GPU | 640 | Wheel | 150.6 / 183.9 | 264 | 0 | 66.3 | 616.6 / 9 |
| GPU | 640 | Pan | 150.0 / 182.9 | 265 | 0 | 74.2 | 329.4 / 33 |
| Software | 1440 | Idle | 50.0 / 50.1 | 190 | 3 / 53 | 136.1 | |
| Software | 1440 | Live | 350.0 / 383.4 | 282 | 14 / 378 | 110.4 | |
| Software | 1440 | Wheel | 400.0 / 516.6 | 310 | 15 / 522 | 109.3 | 1751.8 / 4 |
| Software | 1440 | Pan | 350.1 / 416.7 | 309 | 17 / 405 | 109.7 | 736.4 / 4 |
| Software | 640 | Idle | 33.3 / 33.4 | 139 | 0 | 131.8 | |
| Software | 640 | Live | 166.8 / 200.0 | 266 | 28 / 194 | 110.0 | |
| Software | 640 | Wheel | 199.9 / 299.9 | 280 | 26 / 308 | 109.2 | 912.6 / 8 |
| Software | 640 | Pan | 183.2 / 200.0 | 290 | 32 / 200 | 109.4 | 375.5 / 9 |

Frame callbacks, Canvas commands and snapshot handlers run on `CrRendererMain`. The accelerated 1440 px trace records 422 `DoRasterCHROMIUM` calls and 358 Skia paint passes on `CrGpuMain`. The software trace shows 400 `RasterTask` events on CPU workers and no GPU raster calls. `DirectRenderer::DrawFrame` appears on `VizCompositorThread` in both profiles. Active software phases saturated one renderer core and recorded long tasks. Accelerated active phases missed refreshes with no reported long tasks.

The original Canvas rebuilds its endpoint index, redraws all paths and uses per-stroke shadow blur. Idle draws every refresh. Full snapshots reproject the graph and rebuild ranking data. Prioritize a finite halo without per-stroke shadows, cached paths and labels, idle redraw suppression and coalesced updates before testing a different renderer.

## Optimized renderer

The renderer reuses the projection across metric-only snapshots. It caches curve paths, label measurements and a padded raster of quiet branches in dense views. The halo uses two finite strokes and a brighter core, grouped by activity, with up to 96 emphasized relationships. A hovered branch has its own stroke and endpoint markers. The map coalesces input and snapshots to animation frames, draws only for visible changes or active animation, and sleeps between discrete activity changes in reduced motion.

The optimized packaged run used the same fixture at the same viewport widths and DPR. The 640 px viewport's canvas measured 592 × 450 CSS px after reserving the scrollbar gutter. No profile drew the canvas during the measured idle phase.

| Profile | Width | Phase | Frame p50/p95 (ms) | Missed | Long tasks | CPU % | Input p95 (ms) / n |
|---|---:|---|---:|---:|---:|---:|---:|
| GPU | 1440 | Idle | 16.7 / 17.1 | 0 | 0 | 12.0 |  |
| GPU | 1440 | Live | 16.7 / 17.0 | 0 | 0 | 60.1 |  |
| GPU | 1440 | Wheel | 16.7 / 17.0 | 0 | 0 | 67.1 | 66.4 / 28 |
| GPU | 1440 | Pan | 16.7 / 17.0 | 0 | 0 | 78.0 | 31.9 / 108 |
| GPU | 640 | Idle | 16.7 / 17.0 | 0 | 0 | 11.5 |  |
| GPU | 640 | Live | 16.7 / 17.0 | 0 | 0 | 47.7 |  |
| GPU | 640 | Wheel | 16.7 / 17.0 | 0 | 0 | 49.7 | 48.9 / 31 |
| GPU | 640 | Pan | 16.7 / 17.0 | 0 | 0 | 54.9 | 32.6 / 113 |
| Software | 1440 | Idle | 16.7 / 16.8 | 2 | 0 | 28.4 |  |
| Software | 1440 | Live | 33.2 / 33.4 | 107 | 0 | 187.4 |  |
| Software | 1440 | Wheel | 16.7 / 33.4 | 85 | 0 | 172.3 | 102.6 / 27 |
| Software | 1440 | Pan | 16.7 / 33.4 | 63 | 0 | 176.5 | 48.0 / 59 |
| Software | 640 | Idle | 16.7 / 16.7 | 1 | 0 | 18.5 |  |
| Software | 640 | Live | 16.7 / 16.8 | 14 | 0 | 169.2 |  |
| Software | 640 | Wheel | 16.7 / 16.8 | 5 | 0 | 149.4 | 72.6 / 29 |
| Software | 640 | Pan | 16.7 / 16.7 | 0 | 0 | 146.2 | 34.0 / 83 |

The direct path met the frame and missed-refresh targets in both accelerated views and the 640 px software view. At 1440 px without acceleration, the active phases missed 21–35% of refreshes. Software CPU use rose during active rendering as the map produced more frames. Wheel latency exceeded 50 ms at 1440 px with acceleration and at both widths without acceleration. Pan remained below 50 ms in all four profiles. The 640 px live software view showed 29 labels on its sampled frame, with 81 at 1440 px. The acceptance suite verified zoom, hover, selection and the inspector with acceleration disabled.

## OffscreenCanvas comparison

| Profile | Width | Live p95, direct / offscreen (ms) | Wheel p95, direct / offscreen (ms) | Pan p95, direct / offscreen (ms) | Wheel input p95, direct / offscreen (ms) |
|---|---:|---:|---:|---:|---:|
| GPU | 1440 | 17.0 / 17.0 | 17.0 / 17.0 | 17.0 / 17.0 | 66.4 / 67.0 |
| GPU | 640 | 17.0 / 17.0 | 17.0 / 17.0 | 17.0 / 17.0 | 48.9 / 50.2 |
| Software | 1440 | 33.4 / 33.5 | 33.4 / 33.4 | 33.4 / 33.4 | 102.6 / 116.0 |
| Software | 640 | 16.8 / 33.3 | 16.8 / 33.3 | 16.7 / 16.8 | 72.6 / 73.5 |

Keep direct Canvas 2D. The prototype matched its accelerated frame intervals and missed more refreshes in every active phase of the 1440 px software run. At 640 px in software mode the surface copy raised the live and wheel frame p95 to 33.3 ms. The [usability report](map-usability.md) includes the dense software captures and interaction evidence.

## Full-width workspace and graphics presets

The follow-up uses the same dense CPU fixture, one foreground Edge tab and five-second phases. Set `MAP_PROFILE_ASSETS` to the published bundle's `wwwroot`. Run all three presets with acceleration and repeat Low without it.

```powershell
$env:MAP_PROFILE_PRESETS = 'low,balanced,high'
$env:MAP_PROFILE_GPU_ONLY = '1'
node tests/browser/profile-map.mjs src/web/coverage/graphics-presets
Remove-Item Env:MAP_PROFILE_GPU_ONLY
$env:MAP_PROFILE_PRESETS = 'low'
$env:MAP_PROFILE_SOFTWARE_ONLY = '1'
node tests/browser/profile-map.mjs src/web/coverage/graphics-presets
```

The presets draw one, two or four halo strokes per active band and allow up to 32, 96 or 220 enhanced branches. Every preset draws the quiet branch core. The CPU fixture exercises branch halos and node lighting. Call-glow behavior is covered by browser scenarios with call measurements. [Packaged acceptance](map-usability.md#full-width-workspace-and-graphics-presets)

The 2026-11-28 run used Windows 11 Pro build 28000 and Edge 158.0.4370.45 on the reference Ryzen 5 5500U laptop. The display ran at 60 Hz and DPR 2. The canvases measured 1363 × 549 and 592 × 450 CSS px at 1440 and 640 px. Low capped the backing scale at 1×. Balanced and High both used 2× on this display. Each row is one run. Missed refreshes and long tasks cover all three active phases. Live CPU sums Edge process times, where 100% is one logical core.

| Profile | Width (px) | Preset | Frame p95, live / wheel / pan (ms) | Missed refreshes | Long tasks | Live CPU | Wheel input p95 (ms) | Pan input p95 (ms) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| GPU | 1440 | Low | 17.0 / 17.0 / 17.0 | 0.0% | 0 | 38.3% | 49.3 | 30.8 |
| GPU | 640 | Low | 17.0 / 17.0 / 17.0 | 0.0% | 0 | 34.5% | 49.8 | 32.0 |
| GPU | 1440 | Balanced | 17.0 / 17.0 / 17.0 | 0.0% | 0 | 40.5% | 48.7 | 30.9 |
| GPU | 640 | Balanced | 17.0 / 17.0 / 17.0 | 0.0% | 0 | 38.2% | 50.0 | 32.3 |
| GPU | 1440 | High | 17.0 / 17.0 / 17.0 | 0.0% | 0 | 40.9% | 66.5 | 31.7 |
| GPU | 640 | High | 17.0 / 17.0 / 17.0 | 0.0% | 0 | 37.6% | 49.7 | 32.2 |
| Software | 1440 | Low | 33.4 / 33.4 / 33.3 | 10.6% | 0 | 140.8% | 76.1 | 35.3 |
| Software | 640 | Low | 16.8 / 16.7 / 16.7 | 0.0% | 0 | 84.5% | 65.8 | 32.3 |

Low met the accelerated navigation budget at both widths. High kept frame p95 at 17.0 ms. At 1440 px, High's wheel input p95 was 17.2 ms higher than Low's and exceeded the 50 ms target. Pan stayed within budget. High used 2.6 and 3.1 percentage points more live CPU than Low at 1440 and 640 px respectively.

With software rendering, Low kept pan input below 36 ms at both widths. Wheel input exceeded the 50 ms target at both widths, and the 1440 px run exceeded the frame and missed-refresh targets. Every run drew zero canvas frames during settled idle. Use these results and the [renderer comparison criteria](renderer-direction.md#what-threejs-would-buy) when evaluating a GPU prototype.
