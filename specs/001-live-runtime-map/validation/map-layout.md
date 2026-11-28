# Map layout audit

The original layout assigns module anchors in discovery order, fans methods around their parent and projects edges after placement. Interleaving the modules scatters three disconnected components across the map.

Run `node tests/browser/audit-map-layout.mjs` from the repository root. The script compares the original revision, a component grid ordered by deterministic graph traversal and a bounded-force layout seeded by that grid. The force variant attracts linked methods, repels nearby nodes and limits travel around each starting point.

Both fixtures have 12 modules, three disconnected components and self-loops. The sparse fixture expands 36 methods. The dense fixture expands 250 methods and 750 relationships. Edge metrics use straight endpoint chords and exclude self-loops. The label estimate uses the original rendering rules with 7 px per character. The topology update joins two components. Displacement shows the recomputed positions before a movement limit.

| Fixture | Width | Placement | Mean edge (px) | Crossings | Label overlaps | Move p95/max (px) |
|---|---:|---|---:|---:|---:|---:|
| Sparse | 1440 | Original | 264 | 161 | 13 | 0 / 0 |
| Sparse | 1440 | Component grid | 137 | 6 | 28 | 282 / 302 |
| Sparse | 1440 | Bounded force | 112 | 6 | 28 | 268 / 302 |
| Sparse | 640 | Original | 162 | 161 | 41 | 0 / 0 |
| Sparse | 640 | Component grid | 97 | 6 | 74 | 167 / 172 |
| Sparse | 640 | Bounded force | 81 | 6 | 88 | 157 / 172 |
| Dense | 1440 | Original | 256 | 24975 | 571 | 0 / 0 |
| Dense | 1440 | Component grid | 94 | 2296 | 892 | 284 / 312 |
| Dense | 1440 | Bounded force | 78 | 2751 | 926 | 276 / 312 |
| Dense | 640 | Original | 163 | 24975 | 1295 | 0 / 0 |
| Dense | 640 | Component grid | 66 | 2296 | 1780 | 167 / 179 |
| Dense | 640 | Bounded force | 56 | 2751 | 1861 | 158 / 179 |

Use the component grid at both widths. It produces the fewest dense crossings, keeps methods in module cells and avoids iterative force passes. Cap movement per topology update and preserve coordinates across visibility and metric updates. Reserve room for the unresolved bucket and library overview. Prioritize selected nodes and group labels, then omit colliding method labels under the [design](../DESIGN.md). Zoom and the inspector give access to dense groups.

## Implemented layout

| Fixture | Width | Mean edge (px) | Crossings | Move p95/max (px) |
|---|---:|---:|---:|---:|
| Sparse | 1440 | 137 | 6 | 46 / 46 |
| Sparse | 640 | 97 | 6 | 26 / 26 |
| Dense | 1440 | 94 | 2288 | 46 / 47 |
| Dense | 640 | 66 | 2288 | 26 / 27 |

The audit asserts identical coordinates after reordering the same topology and after a metric-only update across collapse and re-expansion. The bridge update moves existing nodes by at most 0.045 of normalized world coordinates. At the default zoom, that bound is at most 47 CSS px on the wider canvas and 27 CSS px on the narrower canvas. The renderer skips colliding label boxes and shortens long labels with an ellipsis. The inspector keeps the full label.
