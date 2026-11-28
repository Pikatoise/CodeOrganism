import type { GraphNode, Measurement, Projection, Snapshot } from "./graph/layout";
import { displayedRate, methodLabel, metricDetails, toRate, type MetricId } from "./graph/metrics";
import { transitionText } from "./transition";
import { isRussian, nodeLabel, number, t } from "./language";

const rank = document.querySelector<HTMLOListElement>("#cpu-ranking")!;
const name = document.querySelector<HTMLElement>("#selection-name")!;
const values = document.querySelector<HTMLElement>("#selection-values")!;
const groups = document.querySelector<HTMLUListElement>("#groups")!;
const coverage = document.querySelector<HTMLElement>("#coverage")!;
const rankMetric = document.querySelector<HTMLElement>("#rank-metric")!;
const rows = new Map<string, HTMLButtonElement>();
const groupLists = new Map<string | null, { list: HTMLUListElement; buttons: Map<string, HTMLButtonElement> }>();
groupLists.set(null, { list: groups, buttons: new Map() });

export function inspect(snapshot: Snapshot, graph: Projection, selected: string | undefined,
  expanded: ReadonlySet<string>, byMethod: boolean, metric: MetricId, visibleMetrics: readonly MetricId[],
  choose: (node: GraphNode, toggle: boolean) => void) {
  const interval = (snapshot.endMs ?? 0) - (snapshot.startMs ?? 0);
  const definition = metricDetails[metric];
  const capabilities = new Map(snapshot.capabilities.map(item => [item.metric, item]));
  const capability = capabilities.get(metric);
  const index = new Map(snapshot.nodes.map(node => [node.id, node]));
  const library = graph.nodes.find(node => node.kind === "library");
  if (library) index.set(library.id, library);
  const metrics = new Map(visibleMetrics.map(id => [id, new Map<string, Measurement>()]));
  for (const entry of snapshot.measurements) metrics.get(entry.metric as MetricId)?.set(entry.nodeId, entry);
  if (library) for (const [id, readings] of metrics) {
    const available = graph.libraryModules.map(key => readings.get(key)).filter(row => row?.value != null);
    const total = available.reduce((sum, entry) => sum + (entry?.value ?? 0), 0);
    if (available.length && Number.isFinite(total) && (id !== "calls" || Number.isSafeInteger(total))) {
      readings.set(library.id, {
        nodeId: library.id, metric: id, quality: available.some(item => item?.quality === "estimated") ? "estimated" : "exact",
        value: total, complete: available.length === graph.libraryModules.length && available.every(entry => entry?.complete)
      });
    }
  }
  const measurement = metrics.get(metric)!;

  rankMetric.textContent = [byMethod && t("Session peaks"), t(definition.description),
    capability?.quality === "estimated" && t("estimated")].filter(Boolean).join(" · ");
  const candidates = byMethod ? snapshot.nodes.filter(node => node.kind === "method")
    : graph.nodes.filter(node => node.kind === "module" || node.kind === "library");
  const rankings = new Map([...measurement].map(([id, reading]) => [id, { reading, interval }]));
  if (byMethod && snapshot.methodPeaks) {
    rankings.clear();
    for (const peak of snapshot.methodPeaks) {
      if (peak.reading.metric === metric) {
        rankings.set(peak.reading.nodeId, { reading: peak.reading, interval: peak.endMs - peak.startMs });
      }
    }
  }
  const ranked = candidates
    .filter(node => byMethod || rankings.get(node.id)?.reading.value != null)
    .sort((a, b) => {
      const left = rankings.get(a.id), right = rankings.get(b.id);
      if (left?.reading.value == null) return right?.reading.value == null ? 0 : 1;
      if (right?.reading.value == null) return -1;
      if (metric === "calls" && left.reading.complete !== right.reading.complete) return Number(right.reading.complete) - Number(left.reading.complete);
      if (metric === "calls" && !left.reading.complete) return right.reading.value - left.reading.value;
      return toRate(right.reading.value, right.interval) - toRate(left.reading.value, left.interval);
    });

  const focusedId = rank.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.node : undefined;
  const focused = focusedId && candidates.find(node => node.id === focusedId);
  const leaders = byMethod ? ranked : ranked.slice(0, 8);
  const visibleRanks = focused && !leaders.includes(focused) ? [...leaders, focused] : leaders;
  syncButtons(rank, rows, visibleRanks, node => choose(node, false), button => {
    const entry = rankings.get(button.dataset.node!);
    return displayedRate(entry?.reading, metric, entry?.interval ?? 0) +
      (entry?.reading.value != null && !entry.reading.complete && metric !== "calls" ? ` ${t("(partial)")}` : "");
  });
  syncGroups(graph, selected, expanded, choose);

  const picked = selected ? index.get(selected) : undefined;
  const parent = picked?.parentId ? index.get(picked.parentId) : undefined;
  transitionText(name, picked ? [parent && nodeLabel(parent), nodeLabel(picked)].filter(Boolean).join(" / ") : t("Select a node to inspect it."));
  const stats = picked ? visibleMetrics.flatMap(id => {
    const row = metrics.get(id)?.get(picked.id);
    const label = t(metricDetails[id].label);
    const reading = displayedRate(row, id, interval);
    if (id !== "calls") {
      const qualifiers = row?.value == null ? [] : [
        row.quality === "estimated" ? t("estimated") : "",
        row.complete ? "" : t("(partial)")
      ].filter(Boolean);
      return [[label, [reading, ...qualifiers].join(" · ")]];
    }
    const method = capabilities.get(id)?.method;
    const field = (title: string) => visibleMetrics.length === 1 ? t(title)
      : isRussian() ? `${t(title)} · ${label}` : `${label} ${title.toLowerCase()}`;
    const quality = row?.value == null ? "Unavailable" : row.quality === "estimated" ? "Estimated"
      : row.complete ? "Exact" : "Covered entries only";
    const scope = row?.complete ? "Complete checkpoint window" : "Partial checkpoint window";
    return [
      [label, reading],
      ...(row?.value != null && row.complete ? [[t("Entry count"), number(row.value)]] : []),
      [field("Measurement"), method ? methodLabel(method) : t("Unavailable")],
      [field("Quality"), t(quality)],
      [field("Coverage"), t(row?.value == null ? "Unavailable" : scope)]
    ];
  }) : [];
  if (picked) stats.push([t("Interval"), interval > 0 ? `${number(interval)} ${t("ms")}` : t("Unavailable")]);
  values.replaceChildren(...stats.flatMap(([key, value]) => {
    const term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = key; description.textContent = value;
    return [term, description];
  }));

  const messages: string[] = [];
  const relevantLoss = snapshot.loss.filter(item => item.metric == null || visibleMetrics.includes(item.metric as MetricId));
  if (relevantLoss.some(item => item.kind === "source-events")) messages.push(t("Measurement loss in this interval."));
  for (const id of visibleMetrics) {
    if (relevantLoss.some(item => item.kind === "unresolved-attribution" && (item.metric == null || item.metric === id)))
      messages.push(t(metricDetails[id].unresolved));
  }
  if (relevantLoss.some(item => item.kind === "topology-limit")) messages.push(t("Some branches could not fit on the map."));
  if (snapshot.gaps > 0) messages.push(isRussian() ? `Пропущено интервалов за сеанс: ${number(snapshot.gaps)}.`
    : `${snapshot.gaps} interval gap${snapshot.gaps === 1 ? "" : "s"} in this session.`);
  coverage.textContent = messages.join(" ") || (![...measurement.values()].some(row => row.value != null) &&
    snapshot.state === "live" ? t(definition.missing) : "");
}

function syncGroups(graph: Projection, selected: string | undefined, expanded: ReadonlySet<string>,
  choose: (node: GraphNode, toggle: boolean) => void) {
  const libraryIds = new Set(graph.libraryModules);
  const children = new Map<string | null, typeof graph.nodes>();
  const expandable = new Set(graph.nodes.filter(node => node.expandable).map(node => node.id));
  const active = document.activeElement;
  const ancestors: HTMLButtonElement[] = [];
  if (active instanceof HTMLButtonElement && groups.contains(active)) {
    ancestors.push(active);
    for (let list = active.closest("ul"); list && list !== groups; list = list.parentElement?.closest("ul") ?? null) {
      const parent = list.parentElement?.querySelector<HTMLButtonElement>(":scope > button");
      if (parent) ancestors.push(parent);
    }
  }
  const scrollTop = groups.scrollTop;
  for (const node of graph.nodes) {
    const parent = libraryIds.has(node.id) ? graph.libraryId : node.parentId ?? null;
    let siblings = children.get(parent);
    if (!siblings) children.set(parent, siblings = []);
    siblings.push(node);
  }
  const visited = new Set<string | null>();
  renderBranch(null);
  for (const [id, { list }] of groupLists) {
    if (!visited.has(id)) {
      list.remove();
      groupLists.delete(id);
    }
  }
  if (ancestors.length && document.activeElement !== active) {
    (ancestors.find(button => groups.contains(button)) ?? groups).focus({ preventScroll: true });
  }
  groups.scrollTop = scrollTop;

  function renderBranch(parent: string | null, item?: HTMLElement) {
    let branch = groupLists.get(parent);
    if (!branch) {
      branch = { list: document.createElement("ul"), buttons: new Map() };
      groupLists.set(parent, branch);
    }
    if (item && branch.list.parentElement !== item) item.append(branch.list);
    visited.add(parent);
    const nodes = children.get(parent) ?? [];
    syncButtons(branch.list, branch.buttons, nodes, node => choose(node, expandable.has(node.id)), button => {
      const id = button.dataset.node!;
      return expandable.has(id) ? t(expanded.has(id) ? "Collapse" : "Expand") : "";
    });
    for (const node of nodes) {
      const button = branch.buttons.get(node.id)!;
      if (expandable.has(node.id)) button.setAttribute("aria-expanded", String(expanded.has(node.id)));
      else button.removeAttribute("aria-expanded");
      if (selected === node.id) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      if (children.has(node.id)) renderBranch(node.id, button.parentElement!);
    }
  }
}

function syncButtons(container: HTMLElement, existing: Map<string, HTMLButtonElement>, nodes: GraphNode[],
  onPick: (node: GraphNode) => void, summary: (button: HTMLButtonElement) => string) {
  const active = document.activeElement;
  const focusInside = active instanceof HTMLButtonElement && container.contains(active);
  const retained = new Set(nodes.map(node => node.id));
  const previous = [...existing.keys()];
  if (previous.length !== nodes.length || nodes.some((node, index) => node.id !== previous[index])) {
    const scrollTop = container.scrollTop;
    for (const [index, node] of nodes.entries()) {
      let button = existing.get(node.id);
      if (!button) {
        button = document.createElement("button");
        button.dataset.node = node.id;
        button.append(document.createElement("span"), document.createElement("span"));
        const item = document.createElement("li");
        item.append(button);
        existing.set(node.id, button);
      }
      const item = button.parentElement!;
      const reference = container.children[index] ?? null;
      if (item !== reference) {
        if (item.parentElement === container && typeof container.moveBefore === "function") {
          container.moveBefore(item, reference);
        } else container.insertBefore(item, reference);
      }
    }
    for (const [id, button] of existing) {
      if (!retained.has(id)) button.parentElement?.remove();
    }
    const ordered = nodes.map(node => [node.id, existing.get(node.id)!] as const);
    existing.clear();
    for (const [id, button] of ordered) existing.set(id, button);
    if (focusInside && document.activeElement !== active) {
      (container.contains(active) ? active : container).focus({ preventScroll: true });
    }
    container.scrollTop = scrollTop;
  }

  for (const node of nodes) {
    const button = existing.get(node.id)!;
    button.onclick = () => onPick(node);
    setText(button.children[0], nodeLabel(node));
    setText(button.children[1], summary(button));
  }
}

function setText(element: Element, value: string) {
  if (element.textContent !== value) element.textContent = value;
}
