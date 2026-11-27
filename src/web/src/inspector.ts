import type { GraphNode, Measurement, Projection, Snapshot } from "./graph/layout";
import { displayedRate, methodLabel, metricDetails, type MetricId } from "./graph/metrics";

const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const rank = document.querySelector<HTMLOListElement>("#cpu-ranking")!;
const heading = document.querySelector<HTMLElement>("#ranking-title")!;
const details = document.querySelector<HTMLDetailsElement>("#details")!;
const name = document.querySelector<HTMLElement>("#selection-name")!;
const values = document.querySelector<HTMLElement>("#selection-values")!;
const groups = document.querySelector<HTMLElement>("#groups")!;
const coverage = document.querySelector<HTMLElement>("#coverage")!;
const rankMetric = document.querySelector<HTMLElement>("#rank-metric")!;
const rows = new Map<string, HTMLButtonElement>();
const groupButtons = new Map<string, HTMLButtonElement>();
const narrow = matchMedia("(max-width: 760px)");

details.open = !narrow.matches;
narrow.addEventListener("change", event => { details.open = !event.matches; });
export function showDetails() { details.open = true; }

export function inspect(snapshot: Snapshot, graph: Projection, selected: string | undefined,
  expanded: ReadonlySet<string>, metric: MetricId, choose: (node: GraphNode, toggle: boolean) => void) {
  const interval = (snapshot.endMs ?? 0) - (snapshot.startMs ?? 0);
  const definition = metricDetails[metric];
  const measurement = new Map(snapshot.measurements.filter(entry => entry.metric === metric).map(entry => [entry.nodeId, entry]));
  const capability = snapshot.capabilities.find(item => item.metric === metric);
  rankMetric.textContent = definition.description + (capability?.quality === "estimated" ? " · estimated" : "");
  const index = new Map(snapshot.nodes.map(node => [node.id, node]));
  const library = graph.nodes.find(node => node.kind === "library");
  if (library) {
    index.set(library.id, library);
    const available = graph.libraryModules.map(id => measurement.get(id)).filter(row => row?.value != null);
    if (available.length) measurement.set(library.id, {
      nodeId: library.id, metric, quality: available.some(item => item?.quality === "estimated") ? "estimated" : "exact",
      value: available.reduce((total, entry) => total + (entry?.value ?? 0), 0),
      complete: available.length === graph.libraryModules.length && available.every(entry => entry?.complete)
    });
  }

  const byMethod = graph.nodes.some(node => node.kind === "method");
  heading.textContent = byMethod ? "Top methods" : "Top modules";
  const candidates = byMethod ? snapshot.nodes.filter(node => node.kind === "method")
    : graph.nodes.filter(node => node.kind === "module" || node.kind === "library");
  const active = candidates
    .filter(node => measurement.get(node.id)?.value != null)
    .sort((a, b) => measurement.get(b.id)!.value! - measurement.get(a.id)!.value!)
    .slice(0, 8);

  syncButtons(rank, rows, active, node => choose(node, false), button => {
    const row = measurement.get(button.dataset.node!)!;
    return displayedRate(row, metric, interval) + (row.complete ? "" : " (partial)");
  });
  syncButtons(groups, groupButtons, graph.nodes.filter(node => node.expandable), node => choose(node, true),
    button => expanded.has(button.dataset.node!) ? "Collapse" : "Expand");
  for (const [id, button] of groupButtons) button.setAttribute("aria-expanded", String(expanded.has(id)));

  const picked = selected ? index.get(selected) : undefined;
  const parent = picked?.parentId ? index.get(picked.parentId) : undefined;
  name.textContent = picked ? [parent?.label, picked.label].filter(Boolean).join(" / ") : "Select a node to inspect it.";
  const row = picked ? measurement.get(picked.id) : undefined;
  const quality = row?.value == null ? "Unavailable" : row.quality === "estimated" ? "Estimated" : "Exact";
  const stats = picked ? [
    [definition.label, displayedRate(row, metric, interval)],
    ["Measurement", capability ? methodLabel(capability.method) : "Unavailable"],
    ["Quality", quality],
    ["Interval", interval > 0 ? `${format.format(interval)} ms` : "Unavailable"],
    ["Coverage", row?.value == null ? "Unavailable" : row.complete ? "Complete sample window" : "Partial sample window"]
  ] : [];
  values.replaceChildren(...stats.flatMap(([key, value]) => {
    const term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = key; description.textContent = value;
    return [term, description];
  }));

  const messages: string[] = [];
  const relevantLoss = snapshot.loss.filter(item => item.metric == null || item.metric === metric);
  if (relevantLoss.some(item => item.kind === "source-events")) messages.push("Measurement loss in this interval.");
  if (relevantLoss.some(item => item.kind === "unresolved-attribution")) messages.push(definition.unresolved);
  if (relevantLoss.some(item => item.kind === "topology-limit")) messages.push("Some branches could not fit on the map.");
  if (snapshot.gaps > 0) messages.push(`${snapshot.gaps} interval gap${snapshot.gaps === 1 ? "" : "s"} in this session.`);
  coverage.textContent = messages.join(" ") || (!active.length && snapshot.state === "live" ? definition.missing : "");
}

function syncButtons(container: HTMLElement, existing: Map<string, HTMLButtonElement>, nodes: GraphNode[],
  onPick: (node: GraphNode) => void, summary: (button: HTMLButtonElement) => string) {
  const active = document.activeElement?.getAttribute("data-node");
  const retained = new Set(nodes.map(node => node.id));
  const previous = [...existing.keys()];
  if (previous.length !== nodes.length || nodes.some((node, index) => node.id !== previous[index])) {
    const next = nodes.map(node => {
      let button = existing.get(node.id);
      if (!button) {
        button = document.createElement("button");
        button.dataset.node = node.id;
        button.append(document.createElement("span"), document.createElement("span"));
      }
      return button;
    });
    existing.clear();
    const items = next.map((button, index) => {
      existing.set(nodes[index].id, button);
      const item = document.createElement("li"); item.append(button); return item;
    });
    container.replaceChildren(...items);
    if (active && retained.has(active)) existing.get(active)?.focus({ preventScroll: true });
  }

  for (const node of nodes) {
    const button = existing.get(node.id)!;
    button.onclick = () => onPick(node);
    setText(button.children[0], node.label);
    setText(button.children[1], summary(button));
  }
}

function setText(element: Element, value: string) {
  if (element.textContent !== value) element.textContent = value;
}
