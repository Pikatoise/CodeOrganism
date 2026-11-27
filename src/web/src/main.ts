import "./style.css";
import { RuntimeMap } from "./graph/map";
import { isLibrary, StableLayout, type GraphNode, type Snapshot } from "./graph/layout";
import { inspect, showDetails } from "./inspector";
import { connectControls } from "./control";

const status = document.querySelector<HTMLElement>("#source-status")!;
const empty = document.querySelector<HTMLElement>("#map-empty")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const layout = new StableLayout();
const expanded = new Set<string>();
const map = new RuntimeMap(document.querySelector<HTMLCanvasElement>("#runtime-map")!, node => choose(node, node.expandable));
let latest: Snapshot | undefined;
let displayed: Snapshot | undefined;
let selected: string | undefined;
let paused = false;
let online = false;
let control = { state: "idle" };

const controls = connectControls(next => { control = next; updateStatus(); });
const stream = new EventSource("/api/view/v1/events");
stream.onopen = () => { online = true; updateStatus(); };
stream.onerror = () => { online = false; updateStatus(); };
stream.addEventListener("snapshot", (event: MessageEvent<string>) => {
  const snapshot = JSON.parse(event.data) as Snapshot;
  if (latest?.sessionId === snapshot.sessionId && latest.version > snapshot.version) return;
  const sameVersion = latest?.sessionId === snapshot.sessionId && latest.version === snapshot.version;
  latest = snapshot;
  online = true;
  controls.externalLive(snapshot.state === "live" || snapshot.state === "connecting");
  updateStatus();
  if (!paused && !sameVersion) apply(snapshot);
});
window.setInterval(updateStatus, 250);

pauseButton.addEventListener("click", () => {
  paused = !paused;
  map.pause(paused);
  pauseButton.textContent = paused ? "Resume" : "Pause";
  if (!paused && latest) {
    if (displayed?.version !== latest.version || displayed.sessionId !== latest.sessionId) apply(latest);
    else render();
  }
});
document.querySelector("#zoom-in")!.addEventListener("click", () => map.zoomBy(1.25));
document.querySelector("#zoom-out")!.addEventListener("click", () => map.zoomBy(1 / 1.25));
document.querySelector("#reset-view")!.addEventListener("click", () => map.reset());

function choose(node: GraphNode, toggle: boolean) {
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
  showDetails();
  render();
  if (!toggle) map.focus(node.id);
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
  if (!displayed) return;
  empty.hidden = displayed.nodes.length > 0;
  pauseButton.disabled = displayed.nodes.length === 0;
  const graph = layout.project(displayed, expanded);
  map.show(graph, selected);
  inspect(displayed, graph, selected, expanded, choose);
}

function updateStatus() {
  if (!online) return showStatus("connecting", "Connecting to the local visualizer");
  if (control.state === "detaching") return showStatus("connecting", "Detaching");
  if (control.state === "connecting" && latest?.state !== "live") return showStatus("connecting", "Connecting to process");
  if (latest?.state === "live") {
    const stale = Date.now() - Date.parse(latest.lastUpdate) > 2_500;
    return showStatus(stale ? "stale" : "live", `${latest.source.label} · ${stale ? "Waiting for updates" : "Live"}`);
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

function showStatus(state: string, label: string) {
  status.dataset.state = state;
  if (status.textContent !== label) status.textContent = label;
}
