# Live Runtime Map Design

Visual reference: [CodeOrganism reference](../../docs/CodeOrganism_reference.png). Use a dark field, luminous organic curves and muted secondary branches. Let observed topology decide whether the map has one center or several. Keep labels readable through grouping and focus. Avoid arranging unrelated modules around an invented root.

## Reference states

| State | Map | Controls and evidence |
|---|---|---|
| Module overview | A small number of labeled module clusters. Overview shows the selected metric and stable dark branches. | Source status, metric selector, pause and a ranked list. The first available metric selects the initial view, with CPU preferred. |
| Expanded module during a spike | Revealed methods branch from the module. The active method and branch light up. Balanced and High animate the pulse, while Low shows a temporary static highlight. | Inspector shows path, metric, unit, interval, quality and observed coverage. Selecting a ranked item focuses that node, revealing its parent if needed. |
| Combined view | Pulse rhythm represents CPU, node radius represents allocation rate and halo strength represents call rate. Use a stable base silhouette and one color family. | Legend shows each channel, current values and unavailable states. The ranked list has a clearly labeled ranking metric. |

Use the full workspace width for the map at 1440 and 640 px. Put ranking, Inspector and Groups below the map as independent disclosures. A closed disclosure shows only its heading. Place coverage and loss messages inside the ranking disclosure so they appear when it opens. Interacting with a node or branch preserves the disclosure state. Selection still updates the inspector content. Provide keyboard access through HTML controls and the ranked list. Ensure each metric is readable in text. Pausing fixes the measurements, topology and visual phase while allowing selection, pan, zoom and expansion. Resuming reads the latest state. Show connecting, unavailable, stale/incomplete and disconnected states with a short textual reason.

## Activity effects

Use bright neon for active branches and a single palette per theme. Distinguish CPU by pulse, allocation rate by node size and call rate by halo. Keep quiet relationships visible in the background.

Compare each node's measured load with its own recent baseline. A transition from a measured zero to any positive load must be immediately visible, even when the value would normally produce a faint effect. Trigger a new pulse on a noticeable increase and let it fade gradually. An unavailable reading leaves the baseline unresolved until there is a measurement. Visual decay affects emphasis only.

Highlight the active part of the graph automatically. Hovering or selecting a branch reveals only its nearest incoming and outgoing relationships, with direction and individual branches still distinguishable.

Use the reviewed immediate-neighborhood view (B). The graph stays in place and quiet links recede while the selected branch and its neighbors stand out. [Relationship view comparison](validation/relationship-views.md)

Low is the only preset that disables live map animation. Show a spike in Low by temporarily increasing brightness without pulsing or moving. Balanced and High animate the map even when the system prefers reduced motion. Interface transitions outside the map continue to follow the system preference. Pause freezes the current visual phase in each preset.

Compare the same sparse graph, dense fixture and two similarly connected components at 1440 and 640 px. Check whether a viewer can spot the active branch, follow its immediate continuation, distinguish the metrics and find the first small increase from zero.

The [visual reference captures](validation/design/README.md) show all three states at both widths. The combined reference uses synthetic data and describes the later allocation and call-frequency phases.
