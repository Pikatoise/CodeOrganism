# Live Runtime Map Design

Visual reference: [CodeOrganism reference](../../docs/CodeOrganism_reference.png). Use a dark field, luminous organic curves and muted secondary branches. Let observed topology decide whether the map has one center or several. Keep labels readable through grouping and focus. Avoid arranging unrelated modules around an invented root.

## Reference states

| State | Map | Controls and evidence |
|---|---|---|
| Module overview | A small number of labeled module clusters. Overview shows the selected metric and stable dark branches. | Source status, metric selector, pause and a ranked list. The first available metric selects the initial view, with CPU preferred. |
| Expanded module during a spike | Revealed methods branch from the module. The active method pulses, then fades gradually. Its neighboring evidence remains selectable. | Inspector shows path, metric, unit, interval, quality and observed coverage. Selecting a ranked item focuses that node, revealing its parent if needed. |
| Combined view | Pulse rhythm represents CPU, node radius represents allocation rate and halo strength represents call rate. Use a stable base silhouette and one color family. | Legend shows each channel, current values and unavailable states. The ranked list has a clearly labeled ranking metric. |

At 1440 px keep the inspector beside the map. At 640 px let it collapse, leaving the map and core controls visible. Provide keyboard access through HTML controls and the ranked list, and use a static CPU emphasis under reduced-motion settings. Ensure each metric is readable in text. Pausing fixes the measurements, topology and visual phase while allowing selection, pan, zoom and expansion. Resuming reads the latest state. Show connecting, unavailable, stale/incomplete and disconnected states with a short textual reason.

Start with approximately one-second metric windows and a two-second visual fade after the last active window. Tune these in PoC against the agreed render latency. Within a view, use a distinct stable scale per metric based on recent values and clamp outliers. Apply decay only to visual emphasis and disclose the displayed units in the legend. A deliberately static CPU emphasis is the reduced-motion equivalent of pulse.

The reference states above define behavior and composition. Before production UI work, create visual mockups for the three states and validate their layout at both widths.
