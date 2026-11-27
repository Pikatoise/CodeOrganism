import "./style.css";
import { RuntimeMap, type Snapshot } from "./graph/map";

const status = document.querySelector<HTMLElement>("#source-status")!;
const empty = document.querySelector<HTMLElement>("#map-empty")!;
const ranking = document.querySelector<HTMLOListElement>("#cpu-ranking")!;
const coverage = document.querySelector<HTMLElement>("#coverage")!;
const windowLabel = document.querySelector<HTMLElement>("#window")!;
const map = new RuntimeMap(document.querySelector<HTMLCanvasElement>("#runtime-map")!);
const stream = new EventSource("/api/view/v1/events");
const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
let latest: Snapshot | undefined;
stream.onopen = () => {
  if (!latest) showStatus("idle", "No source connected");
};

stream.onerror = () => showStatus("connecting", "Reconnecting to the local visualizer");
stream.addEventListener("snapshot", (event: MessageEvent<string>) => {
  const snapshot = JSON.parse(event.data) as Snapshot;
  if (latest?.sessionId === snapshot.sessionId && latest.version > snapshot.version) return;
  latest = snapshot;
  showStatus(snapshot.state, `${snapshot.source.label} · ${labels[snapshot.state]}`);
  empty.hidden = snapshot.nodes.length > 0;
  map.update(snapshot);
  renderMeasurements(snapshot);
});

const labels = {
  connecting: "Connecting",
  live: "Live",
  ended: "Disconnected",
  failed: "Source unavailable",
};

function showStatus(state: string, label: string) {
  status.dataset.state = state;
  if (status.textContent !== label) status.textContent = label;
}

function renderMeasurements(snapshot: Snapshot) {
  const interval = (snapshot.endMs ?? 0) - (snapshot.startMs ?? 0);
  const methods = new Map(snapshot.nodes.filter(node => node.kind === "method").map(node => [node.id, node.label]));
  const rows = snapshot.measurements
    .filter(entry => entry.metric === "cpu" && entry.value != null && methods.has(entry.nodeId))
    .sort((a, b) => b.value! - a.value!)
    .slice(0, 8)
    .map(entry => {
      const row = document.createElement("li");
      const name = document.createElement("span");
      const value = document.createElement("span");
      name.textContent = methods.get(entry.nodeId)!;
      value.textContent = interval > 0 ? `${format.format(entry.value! * 1_000 / interval)} ms/s` : "Unavailable";
      if (!entry.complete) value.textContent += " (partial)";
      row.append(name, value);
      return row;
    });
  ranking.replaceChildren(...rows);
  windowLabel.textContent = interval > 0 ? `CPU milliseconds per second · ${interval} ms window` : "CPU milliseconds per second";
  const messages: string[] = [];
  if (snapshot.loss.some(item => item.kind === "source-events")) messages.push("Measurement loss in this interval.");
  if (snapshot.loss.some(item => item.kind === "unresolved-attribution")) messages.push("Some CPU samples could not be attributed.");
  if (snapshot.gaps > 0) messages.push(`${snapshot.gaps} interval gap${snapshot.gaps === 1 ? "" : "s"} in this session.`);
  coverage.textContent = messages.join(" ");
  if (rows.length === 0 && snapshot.state === "live") coverage.textContent ||= "No method sample in this interval.";
}
