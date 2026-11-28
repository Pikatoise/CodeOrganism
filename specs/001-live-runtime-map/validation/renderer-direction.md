# Renderer direction

**Recommendation**: Keep the current 2D view for the workspace and visual changes. Consider Three.js with an orthographic camera if the richer presets expose a measurable rendering bottleneck. Consider full 3D only when depth has a specific diagnostic purpose, such as showing call layers that the operator can isolate.

## Why ordinary branches curl

The previous `buildGeometry` calculated `curl = 0.38 × (b.y − a.y) + 15` and offset both axes of the cubic Bézier control points by that value. An 8 px horizontal edge from x=0 to x=8 had control points at x=15 and x=−7, so the curve doubled back. Zooming out shortened the span while retaining the fixed bend.

The current renderer places control points one-third and two-thirds along the chord, then offsets them perpendicular to it. The table gives the midpoint offset in CSS pixels for representative single-direction branches.

| Endpoints | Span | Midpoint offset |
|---|---:|---:|
| (0, 0) to (8, 0) | 8 | 0.48 |
| (0, 0) to (120, 0) | 120 | 7.2 |
| (0, 0) to (0, 100) | 100 | 6 |
| (0, 0) to (600, 800) | 1,000 | 9 |

Reciprocal branches bend to opposite sides of the chord. Actual self-loops retain a dedicated shape. The renderer and branch picking use the same control points. [Curve construction](../../../src/web/src/graph/map.ts)

Build ordinary curves from the endpoint chord. Keep the control points in order along the chord and limit their perpendicular offset to a fraction of its length. Use small opposite bends for reciprocal links and preserve compact self-loops for recursion. Feed the same geometry to rendering and hit testing.

## What Three.js would buy

The effects in this round work in a planar view. Three.js can also render a planar scene with an orthographic camera, batch repeated node geometry through instancing, and add an optional bloom pass. The WebGL renderer requires WebGL 2. A bloom pass adds render work of its own. [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html), [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [UnrealBloomPass](https://threejs.org/docs/pages/UnrealBloomPass.html)

Depth could separate meaningful call layers. For the current topology it would introduce camera-dependent occlusion, label placement and picking work. Three.js supplies raycasting. The map would still need a consistent policy for which label, node or edge wins when they overlap. [Raycaster](https://threejs.org/docs/pages/Raycaster.html)

The existing test with 250 methods and 750 relationships measured a 17.0 ms live p95 frame interval at 1440 px with acceleration and 33.4 ms in software. These are Canvas 2D measurements before the wider layout and richer effects. The OffscreenCanvas experiment used the same 2D renderer and a surface copy. [Render performance](render-performance.md)

If the richer map needs GPU rendering, compare an orthographic Three.js prototype against Canvas 2D on the same snapshots, widths and quality presets. Compare frame p95, zoom response and the time it takes to locate a branch or node. Keep a software-capable view for browsers without WebGL 2. A full 3D view would need to demonstrate a diagnostic advantage on the same tasks.
