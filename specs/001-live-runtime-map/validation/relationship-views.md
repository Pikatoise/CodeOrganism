# Relationship view comparison

The captures show the same directed relationship in each view, from `Module 0 / HandleRequest0` to `Module 3 / HandleRequest0`. The dense graph reuses the 12-module, 250-method, 750-relationship fixture. The sparse and similar-component scenarios take subsets of that fixture. Read the panels in letter order at both widths.

| Scenario | 1440 px | 640 px |
|---|---|---|
| Sparse graph | [Capture](relationship-captures/sparse-1440.png) | [Capture](relationship-captures/sparse-640.png) |
| Dense graph | [Capture](relationship-captures/dense-1440.png) | [Capture](relationship-captures/dense-640.png) |
| Similar components | [Capture](relationship-captures/similar-1440.png) | [Capture](relationship-captures/similar-640.png) |

| View | Readability and trade-offs |
|---|---|
| A. Current map | The baseline keeps all branches in context at fixed positions. The highlighted edge is easy to follow in the sparse view. In the dense view the surrounding lines compete with its continuation. |
| B. Immediate neighborhood | The selected relationship and links touching its two endpoints stand out while the other links remain visible. It keeps the same positions as A and a single selection reveals both ends and their immediate neighbors. Repeated patterns across components remain harder to compare. |
| C. Module bundles | One directed curve summarizes the observed links for an ordered module pair. The capture shows one expanded bundle. This reduces the overview to a few strong inter-module connections. Finding a method requires opening a bundle and choosing an edge. Preserve the original edge IDs and evidence types in the expanded view. [Hierarchical edge bundles](https://pubmed.ncbi.nlm.nih.gov/17080795/) |
| D. Directed adjacency matrix | Rows are sources and columns are targets. Groups with similar patterns form similar blocks, and the diagonal holds self-loops. The dense view needs zoom or grouping to make cells easy to select. Following a chain requires tracing across several rows and columns. [Controlled node-link and matrix comparison](https://mohammad.ghoniem.info/research/ivs-usability-2005.pdf) |

**Recommendation**: Begin with B as the live map because the first priority is spotting the active branch and following its immediate continuation. A and B use the same projected coordinates. C and D can supplement the map for cross-module overviews and pattern comparison. The captures stage one selection in each view. Interaction cost describes the expected actions and has not been timed.

To regenerate the captures with the installed browser dependencies, run `node tests/browser/capture-relationship-views.mjs` from the repository root.
