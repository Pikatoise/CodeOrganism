type GraphNode = { id: string; kind: "module" | "method" | "unresolved"; label: string; parentId?: string | null };
type Relationship = { sourceId: string; targetId: string };
type Measurement = { nodeId: string; metric: string; value: number | null; complete: boolean };
export type Snapshot = {
  sessionId: string;
  version: number;
  state: "connecting" | "live" | "ended" | "failed";
  source: { label: string };
  startMs: number | null;
  endMs: number | null;
  nodes: GraphNode[];
  relationships: Relationship[];
  measurements: Measurement[];
  loss: { kind: string }[];
  gaps: number;
};

type Point = { x: number; y: number };
type VisibleNode = { node: GraphNode; center: Point; heat: number; lastPulse: number };

export class RuntimeMap {
  private readonly context: CanvasRenderingContext2D;
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly positions = new Map<string, VisibleNode>();
  private edges: Relationship[] = [];
  private sessionId = "";
  private size = { x: 0, y: 0 };
  private scale = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    requestAnimationFrame(this.frame);
  }

  update(snapshot: Snapshot) {
    if (this.sessionId !== snapshot.sessionId) {
      this.sessionId = snapshot.sessionId;
      this.positions.clear();
    }
    this.edges = snapshot.relationships;
    let moduleNumber = [...this.positions.values()].filter(item => item.node.kind === "module").length;
    const sorted = [...snapshot.nodes].sort((a, b) => Number(b.kind === "module") - Number(a.kind === "module"));
    for (const node of sorted) {
      const prior = this.positions.get(node.id);
      if (prior) {
        prior.node = node;
        continue;
      }
      let center: Point;
      if (node.kind === "module") {
        const anchors = [[.48, .51], [.76, .32], [.24, .3], [.74, .72], [.25, .72], [.49, .22]];
        const anchor = anchors[moduleNumber++] ?? [.2 + hash(node.id) * .6, .2 + hash(node.id + "#") * .6];
        center = { x: anchor[0], y: anchor[1] };
      } else {
        const parent = node.parentId ? this.positions.get(node.parentId)?.center : undefined;
        const angle = hash(node.id) * Math.PI * 2;
        const radius = .10 + hash(node.id + "#") * .13;
        center = parent
          ? { x: clamp(parent.x + Math.cos(angle) * radius), y: clamp(parent.y + Math.sin(angle) * radius) }
          : { x: .84, y: .83 };
      }
      this.positions.set(node.id, { node, center, heat: 0, lastPulse: 0 });
    }
    const now = performance.now();
    const duration = (snapshot.endMs ?? 0) - (snapshot.startMs ?? 0);
    for (const measure of snapshot.measurements) {
      const node = this.positions.get(measure.nodeId);
      if (!node || measure.metric !== "cpu" || !measure.value || duration <= 0) continue;
      node.lastPulse = now;
      node.heat = Math.min(1, Math.sqrt(measure.value / duration));
    }
  }

  private resize() {
    this.size = { x: this.canvas.clientWidth, y: this.canvas.clientHeight };
    this.scale = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = this.size.x * this.scale;
    this.canvas.height = this.size.y * this.scale;
  }

  private readonly frame = (now: number) => {
    const context = this.context;
    context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    context.clearRect(0, 0, this.size.x, this.size.y);
    const point = (item: VisibleNode) => ({ x: item.center.x * this.size.x, y: item.center.y * this.size.y });
    for (const edge of this.edges) {
      const source = this.positions.get(edge.sourceId);
      const target = this.positions.get(edge.targetId);
      if (!source || !target) continue;
      const a = point(source);
      const b = point(target);
      const heat = Math.max(this.intensity(source, now), this.intensity(target, now));
      context.beginPath();
      context.moveTo(a.x, a.y);
      if (source === target) {
        context.bezierCurveTo(a.x - 25, a.y - 44, a.x + 32, a.y - 37, a.x, a.y);
      } else {
        const curl = (b.y - a.y) * .35 + 15;
        context.bezierCurveTo(a.x + curl, a.y - curl, b.x - curl, b.y + curl, b.x, b.y);
      }
      context.shadowColor = "#b168ff";
      context.shadowBlur = 8 * heat;
      context.strokeStyle = `rgba(199, 154, 255, ${.23 + .62 * heat})`;
      context.lineWidth = 1 + 1.1 * heat;
      context.stroke();
    }

    for (const node of this.positions.values()) {
      const p = point(node);
      const heat = this.intensity(node, now);
      const radius = node.node.kind === "module" ? 6 : 3.2;
      const blink = this.motion.matches ? 1 : .75 + .25 * Math.sin(now / (190 - 95 * heat));
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.shadowColor = "#ce91ff";
      context.shadowBlur = 3 + 24 * heat * blink;
      context.fillStyle = `rgba(225, 188, 255, ${.42 + .58 * heat * blink})`;
      context.fill();
      context.shadowBlur = 0;
      context.font = node.node.kind === "module" ? "600 13px system-ui" : "12px system-ui";
      context.fillStyle = heat > .18 || node.node.kind === "module" ? "#f0d9ff" : "#b6a0cb";
      context.fillText(node.node.label, p.x + 10, p.y + 4, Math.max(30, this.size.x - p.x - 16));
    }
    requestAnimationFrame(this.frame);
  };

  private intensity(node: VisibleNode, now: number) {
    return node.heat * Math.max(0, 1 - (now - node.lastPulse) / 2_000);
  }
}

function hash(value: string) {
  let result = 2_166_136_261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16_777_619);
  return (result >>> 0) / 2 ** 32;
}

function clamp(value: number) {
  return Math.max(.10, Math.min(.86, value));
}
