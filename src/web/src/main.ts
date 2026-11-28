import "./style.css";
import { RuntimeMap, zoomStep } from "./graph/map";
import { isLibrary, StableLayout, type GraphNode, type Snapshot } from "./graph/layout";
import { inspect } from "./inspector";
import { connectControls, type ControlStatus } from "./control";
import { metricDetails, metricIds, type MapMode, type MetricId } from "./graph/metrics";
import { transitionText } from "./transition";
import { t } from "./language";
import { connectSettings } from "./settings";
import { connectFullscreenPanels } from "./fullscreen-panels";

const status = document.querySelector<HTMLElement>("#source-status")!;
const empty = document.querySelector<HTMLElement>("#map-empty")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const collapseAll = document.querySelector<HTMLButtonElement>("#collapse-all")!;
const buttons = {
  cpu: document.querySelector<HTMLButtonElement>("#metric-cpu")!,
  allocation: document.querySelector<HTMLButtonElement>("#metric-allocation")!,
  calls: document.querySelector<HTMLButtonElement>("#metric-calls")!,
  combined: document.querySelector<HTMLButtonElement>("#metric-combined")!
};
const rankingControl = document.querySelector<HTMLElement>("#ranking-control")!;
const rankingMetric = document.querySelector<HTMLSelectElement>("#ranking-metric")!;
const rankingScope = document.querySelector<HTMLSelectElement>("#ranking-scope")!;
const rankingTitle = document.querySelector<HTMLElement>("#ranking-title")!;
const metricCaption = document.querySelector<HTMLElement>("#metric-caption")!;
const metricLegend = document.querySelector<HTMLElement>("#metric-legend")!;
const mapContent = document.querySelector<HTMLElement>("#map-content")!;
const inspector = document.querySelector<HTMLElement>(".inspector")!;
const fullscreen = connectFullscreenPanels(
  document.querySelector<HTMLElement>(".map-area")!, inspector,
  document.querySelector<HTMLElement>("#fullscreen-panels")!,
  document.querySelector<HTMLButtonElement>("#fullscreen-map")!,
  document.querySelector<HTMLElement>("#fullscreen-status")!
);
const overlay = document.querySelector<HTMLElement>("#attach-overlay")!;
const attachProgress = document.querySelector<HTMLElement>("#attach-progress")!;
const canvas = document.querySelector<HTMLCanvasElement>("#runtime-map")!;
const zoomField = document.querySelector<HTMLInputElement>("#zoom-level")!;
const layout = new StableLayout();
const expanded = new Set<string>();
let zoomText = zoomField.value;
const map = new RuntimeMap(canvas, (node, fromBranch) => choose(node, !fromBranch && node.expandable, !fromBranch),
  scale => { zoomField.value = zoomText = `${Number((scale * 100).toFixed(2))}%`; });
let latest: Snapshot | undefined;
let displayed: Snapshot | undefined;
let selected: string | undefined;
let paused = false;
let online = false;
let mode: MapMode = "cpu";
let rankBy: MetricId = "cpu";
let combinedRank: MetricId | undefined;
let control: ControlStatus = { state: "idle" };
let attaching: { pid: number; previousSession?: string; focus: Element | null } | undefined;
let snapshotFrame = 0;

const controls = connectControls(next => {
  control = next;
  if (attaching?.pid === next.pid && ["exited", "detached", "restricted", "unsupported", "failed"].includes(next.state)) {
    finishAttach();
  }
  updateStatus();
}, pid => {
  attaching = { pid, previousSession: latest?.sessionId, focus: document.activeElement };
  mapContent.inert = inspector.inert = true;
  overlay.inert = false;
  overlay.hidden = false;
  map.setLocked(true);
  attachProgress.focus({ preventScroll: true });
  updateStatus();
}, finishAttach);
const stream = new EventSource("/api/view/v1/events");
stream.onopen = () => { online = true; updateStatus(); };
stream.onerror = () => { online = false; finishAttach(); updateStatus(); };
stream.addEventListener("snapshot", (event: MessageEvent<string>) => {
  const snapshot = JSON.parse(event.data) as Snapshot;
  if (latest?.sessionId === snapshot.sessionId && latest.version > snapshot.version) return;
  latest = snapshot;
  online = true;
  controls.externalLive(snapshot.state === "live" || snapshot.state === "connecting");
  const requestedSource = attaching && snapshot.sessionId !== attaching.previousSession &&
    snapshot.source.target === `PID ${attaching.pid}`;
  if (requestedSource && snapshot.state === "live" && paused) {
    paused = false;
    pauseButton.textContent = t("Pause");
    map.pause(false);
  }
  if (!paused && requestedSource) apply(snapshot);
  else if (!paused && !attaching && !snapshotFrame) snapshotFrame = requestAnimationFrame(() => {
    snapshotFrame = 0;
    if (!paused && !attaching && latest && (displayed?.sessionId !== latest.sessionId || displayed.version !== latest.version)) {
      apply(latest);
    }
  });
  if (requestedSource && snapshot.state !== "connecting") finishAttach();
  updateStatus();
});
window.setInterval(updateStatus, 250);

pauseButton.addEventListener("click", () => {
  paused = !paused;
  map.pause(paused);
  pauseButton.textContent = t(paused ? "Resume" : "Pause");
  if (!paused && latest) {
    if (displayed?.version !== latest.version || displayed.sessionId !== latest.sessionId) apply(latest);
    else render();
  }
});
document.querySelector("#zoom-in")!.addEventListener("click", () => map.zoomBy(zoomStep));
document.querySelector("#zoom-out")!.addEventListener("click", () => map.zoomBy(1 / zoomStep));
document.querySelector("#reset-view")!.addEventListener("click", () => map.reset());
function applyZoomText() {
  const input = zoomField.value.trim().replace(/%$/, "").trim().replace(",", ".");
  if (zoomField.value === zoomText || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) {
    zoomField.value = zoomText;
    return;
  }
  map.setZoom(Number(input) / 100);
}
zoomField.addEventListener("blur", applyZoomText);
zoomField.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyZoomText();
  }
});
collapseAll.addEventListener("click", () => {
  const restore = document.activeElement === collapseAll;
  expanded.clear();
  render();
  if (restore) canvas.focus({ preventScroll: true });
});
for (const id of Object.keys(buttons) as MapMode[]) {
  buttons[id].addEventListener("click", () => {
    mode = id;
    if (id !== "combined") rankBy = id;
    render();
  });
}
rankingMetric.addEventListener("change", () => {
  combinedRank = rankingMetric.value as MetricId;
  render();
});
rankingScope.addEventListener("change", render);
connectSettings((quality, languageChanged) => {
  map.configure(quality);
  if (languageChanged) {
    fullscreen.localize();
    pauseButton.textContent = t(paused ? "Resume" : "Pause");
    controls.localize();
    updateStatus();
    render();
  }
});

function choose(node: GraphNode, toggle: boolean, center = true) {
  if (!displayed) return;
  const current = layout.project(displayed, expanded);
  if (toggle) {
    if (expanded.has(node.id)) expanded.delete(node.id);
    else expanded.add(node.id);
  } else if (node.parentId) {
    expanded.add(node.parentId);
    const parent = displayed.nodes.find(item => item.id === node.parentId);
    if (parent && isLibrary(parent)) expanded.add(current.libraryId);
  }
  selected = node.id;
  render();
  if (!toggle && center) map.focus(node.id);
}

function apply(snapshot: Snapshot) {
  if (displayed?.sessionId !== snapshot.sessionId) {
    selected = undefined;
    expanded.clear();
  }
  displayed = snapshot;
  map.update(snapshot);
  render();
}

function render() {
  const byMethod = rankingScope.value === "methods";
  const title = t(byMethod ? "Top methods" : "Top modules");
  if (rankingTitle.textContent !== title) rankingTitle.textContent = title;
  if (!displayed) return;
  const available = metricIds.filter(id => displayed?.capabilities.some(item => item.metric === id));
  if (mode === "combined" ? available.length < 2 : !available.includes(mode)) mode = available[0] ?? "cpu";
  if (mode !== "combined") rankBy = mode;
  else if (combinedRank && available.includes(combinedRank)) rankBy = combinedRank;
  else if (!available.includes(rankBy)) rankBy = available[0];
  for (const id of Object.keys(buttons) as MapMode[]) {
    const enabled = id === "combined" ? available.length > 1 : available.includes(id);
    buttons[id].disabled = !enabled;
    buttons[id].setAttribute("aria-pressed", String(id === mode));
    buttons[id].title = enabled ? "" : t(id === "combined" ? "Combined view requires at least two metrics."
      : id === "calls" ? "This source does not provide call counts. For .NET, attach to a build with entry probes."
      : "This source does not provide the metric.");
  }
  const visibleMetrics = mode === "combined" ? available : [mode];
  rankingControl.hidden = mode !== "combined";
  if ([...rankingMetric.options].map(option => option.value).join() !== available.join()) {
    rankingMetric.replaceChildren(...available.map(id => new Option(t(metricDetails[id].label), id)));
  }
  for (const option of rankingMetric.options) {
    const label = t(metricDetails[option.value as MetricId].label);
    if (option.text !== label) option.text = label;
  }
  rankingMetric.value = rankBy;
  transitionText(metricCaption, t(mode === "combined" ? "Combined activity" : metricDetails[mode].description));
  transitionText(metricLegend, visibleMetrics.map(id => t(metricDetails[id].legend)).join(" · "));
  empty.hidden = displayed.nodes.length > 0;
  pauseButton.disabled = displayed.nodes.length === 0;
  collapseAll.disabled = expanded.size === 0;
  const graph = layout.project(displayed, expanded);
  if (selected && !graph.nodes.some(node => node.id === selected)) {
    const node = displayed.nodes.find(node => node.id === selected);
    const parentId = node?.parentId ?? node?.id;
    selected = graph.nodes.some(node => node.id === parentId) ? parentId
      : parentId && graph.libraryModules.includes(parentId) ? graph.libraryId : undefined;
  }
  map.show(graph, selected, visibleMetrics);
  inspect(displayed, graph, selected, expanded, byMethod, rankBy, visibleMetrics, choose);
}

function updateStatus() {
  if (!online) return showStatus("connecting", "Connecting to the local visualizer");
  if (control.state === "detaching") return showStatus("connecting", "Detaching");
  if (attaching) return showStatus("connecting", "Connecting to process");
  if (control.state === "connecting" && latest?.state !== "live") return showStatus("connecting", "Connecting to process");
  if (latest?.state === "live") {
    const stale = Date.now() - Date.parse(latest.lastUpdate) > 2_500;
    return showStatus(stale ? "stale" : "live", `${latest.source.label} · ${t(stale ? "Waiting for updates" : "Live")}`);
  }
  const terminal: Record<string, string> = {
    exited: "Process exited", detached: "Detached", restricted: "Access restricted",
    unsupported: "Unsupported process", failed: "Source unavailable"
  };
  if (terminal[control.state]) return showStatus(control.state, terminal[control.state]);
  if (latest?.endReason === "target-exited") return showStatus("exited", "Process exited");
  if (latest?.state === "failed") return showStatus("failed", latest.endReason === "source-timeout" ? "Source stopped sending updates" : "Source unavailable");
  if (latest?.state === "connecting") return showStatus("connecting", "Connecting to process");
  return showStatus("idle", latest ? "Disconnected" : "No source connected");
}

function finishAttach() {
  if (!attaching) return;
  const { focus } = attaching;
  attaching = undefined;
  const restore = document.activeElement === attachProgress;
  if (restore) attachProgress.blur();
  overlay.inert = true;
  overlay.hidden = true;
  mapContent.inert = inspector.inert = false;
  map.setLocked(false);
  updateStatus();
  if (!restore) return;
  requestAnimationFrame(() => {
    if (attaching || document.activeElement !== document.body) return;
    if (focus instanceof HTMLElement && focus.isConnected && !focus.matches(":disabled") && focus !== document.body) {
      focus.focus({ preventScroll: true });
    } else {
      (document.querySelector<HTMLElement>("#detach:not(:disabled)") ??
        document.querySelector<HTMLElement>("#pid"))?.focus({ preventScroll: true });
    }
  });
}

function showStatus(state: string, label: string) {
  status.dataset.state = state;
  const text = t(label);
  if (status.textContent !== text) status.textContent = text;
}
