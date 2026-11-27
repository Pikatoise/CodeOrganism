import type { Point, PositionedNode, Projection, Snapshot } from "./layout";
import { metricDetails, metricIds, toRate, type MetricId } from "./metrics";

type Heat = { amount: number; since: number };
export class RuntimeMap {
  private readonly context: CanvasRenderingContext2D;
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly heat: Record<MetricId, Map<string, Heat>> = { cpu: new Map(), allocation: new Map(), calls: new Map() };
  private metrics: readonly MetricId[] = ["cpu"];
  private graph?: Projection;
  private selected?: string;
  private size = { x: 0, y: 0 };
  private shift = { x: 0, y: 0 };
  private scale = 1;
  private zoom = 1;
  private frozenAt?: number;
  private sessionId = "";
  private pointer?: { x: number; y: number; dx: number; dy: number; moved: boolean };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly select: (node: PositionedNode) => void) {
    this.context = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("pointerdown", event => {
      this.pointer = { x: event.clientX, y: event.clientY, dx: this.shift.x, dy: this.shift.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (!this.pointer) return;
      const dx = event.clientX - this.pointer.x, dy = event.clientY - this.pointer.y;
      this.pointer.moved ||= Math.hypot(dx, dy) > 4;
      if (this.pointer.moved) this.shift = { x: this.pointer.dx + dx, y: this.pointer.dy + dy };
    });
    canvas.addEventListener("pointerup", event => {
      if (this.pointer && !this.pointer.moved) {
        const rect = canvas.getBoundingClientRect();
        this.pick({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }
      this.pointer = undefined;
    });
    canvas.addEventListener("pointercancel", () => { this.pointer = undefined; });
    canvas.addEventListener("wheel", event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      const offsets: Record<string, Point> = { ArrowLeft: { x: -30, y: 0 }, ArrowRight: { x: 30, y: 0 },
        ArrowUp: { x: 0, y: -30 }, ArrowDown: { x: 0, y: 30 } };
      const offset = offsets[event.key];
      if (offset) {
        event.preventDefault();
        this.shift = { x: this.shift.x + offset.x, y: this.shift.y + offset.y };
      } else if (event.key === "+" || event.key === "-") {
        event.preventDefault();
        this.zoomBy(event.key === "+" ? 1.2 : 1 / 1.2);
      }
    });
    requestAnimationFrame(this.frame);
  }

  update(snapshot: Snapshot) {
    if (this.sessionId !== snapshot.sessionId) {
      this.sessionId = snapshot.sessionId;
      for (const metric of metricIds) this.heat[metric].clear();
      this.reset();
    }
    if (snapshot.state !== "live") return;
    const duration = (snapshot.endMs ?? 0) - (snapshot.startMs ?? 0);
    if (duration <= 0) return;
    const now = performance.now();
    for (const measure of snapshot.measurements) {
      const metric = measure.metric;
      if (metric === "cpu" || metric === "allocation" || metric === "calls") {
        if (measure.value == null) {
          this.heat[metric].delete(measure.nodeId);
          continue;
        }
        const amount = Math.min(1, metricDetails[metric].strength(toRate(measure.value, duration)));
        this.heat[metric].set(measure.nodeId, { amount, since: now });
      }
    }
  }

  show(graph: Projection, selected: string | undefined, metrics: readonly MetricId[]) {
    this.graph = graph;
    this.selected = selected;
    this.metrics = metrics;
  }
  pause(paused: boolean) { this.frozenAt = paused ? performance.now() : undefined; }
  zoomBy(factor: number) { this.zoom = Math.max(.55, Math.min(3.5, this.zoom * factor)); }
  reset() { this.zoom = 1; this.shift = { x: 0, y: 0 }; }
  focus(id: string) {
    const found = this.graph?.nodes.find(node => node.id === id);
    if (!found) return;
    this.shift = { x: (0.5 - found.point.x) * this.size.x * this.zoom,
      y: (0.5 - found.point.y) * this.size.y * this.zoom };
  }

  private pick(point: Point) {
    let distance = 21;
    let picked: PositionedNode | undefined;
    for (const node of this.graph?.nodes ?? []) {
      const hit = this.screen(node.point);
      const next = Math.hypot(point.x - hit.x, point.y - hit.y);
      if (next < distance) { distance = next; picked = node; }
    }
    if (picked) this.select(picked);
  }

  private resize() {
    this.size = { x: this.canvas.clientWidth, y: this.canvas.clientHeight };
    this.scale = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = this.size.x * this.scale;
    this.canvas.height = this.size.y * this.scale;
  }

  private screen(point: Point) {
    return { x: (.5 + (point.x - .5) * this.zoom) * this.size.x + this.shift.x,
      y: (.5 + (point.y - .5) * this.zoom) * this.size.y + this.shift.y };
  }

  private readonly frame = (frameTime: number) => {
    const context = this.context;
    const now = this.frozenAt ?? frameTime;
    context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    context.clearRect(0, 0, this.size.x, this.size.y);
    const graph = this.graph;
    if (graph) {
      const index = new Map(graph.nodes.map(node => [node.id, node]));
      for (const edge of graph.edges) {
        const source = index.get(edge.sourceId), target = index.get(edge.targetId);
        if (!source || !target) continue;
        const a = this.screen(source.point), b = this.screen(target.point);
        const heat = Math.max(this.intensity(source, "cpu", now), this.intensity(target, "cpu", now));
        context.beginPath(); context.moveTo(a.x, a.y);
        if (source === target) context.bezierCurveTo(a.x - 26, a.y - 43, a.x + 33, a.y - 36, a.x, a.y);
        else {
          const curl = (b.y - a.y) * .38 + 15;
          context.bezierCurveTo(a.x + curl, a.y - curl, b.x - curl, b.y + curl, b.x, b.y);
        }
        context.shadowColor = "#b168ff";
        context.shadowBlur = 6 * heat;
        context.strokeStyle = `rgba(199, 154, 255, ${.25 + .59 * heat})`;
        context.lineWidth = 1 + heat;
        context.stroke();
      }

      for (const node of graph.nodes) {
        const p = this.screen(node.point);
        const heat = this.intensity(node, "cpu", now);
        const allocation = this.intensity(node, "allocation", now);
        const calls = this.intensity(node, "calls", now);
        const focused = node.id === this.selected;
        const baseRadius = node.kind === "module" || node.kind === "library" ? 6 : 3.5;
        const radius = baseRadius + 14 * allocation;
        if (calls > 0) {
          const outer = radius + 6 + 19 * calls;
          const glow = context.createRadialGradient(p.x, p.y, radius, p.x, p.y, outer);
          glow.addColorStop(0, `rgba(105, 213, 240, ${.9 * calls})`);
          glow.addColorStop(1, "rgba(105, 213, 240, 0)");
          context.beginPath(); context.arc(p.x, p.y, outer, 0, Math.PI * 2);
          context.shadowBlur = 0; context.fillStyle = glow; context.fill();
        }
        const pulse = this.motion.matches ? 1 : .71 + .29 * Math.sin(now / (210 - heat * 125));
        context.beginPath();
        context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        context.shadowColor = "#ce91ff";
        context.shadowBlur = 2 + 25 * heat * pulse;
        context.fillStyle = `rgba(230, 196, 255, ${.47 + .53 * heat * pulse})`;
        context.fill();
        context.shadowBlur = 0;
        if (focused) {
          context.beginPath(); context.arc(p.x, p.y, radius + 8, 0, Math.PI * 2);
          context.strokeStyle = "#edc8ff"; context.lineWidth = 1; context.stroke();
        }
        context.font = node.kind === "method" ? "12px system-ui" : "600 13px system-ui";
        context.fillStyle = focused || heat > .18 ? "#f5dfff" : "#c1abcf";
        const left = p.x > this.size.x * .71;
        context.textAlign = left ? "right" : "left";
        const space = left ? p.x - 16 : this.size.x - p.x - 16;
        if (space > 28) context.fillText(node.label, p.x + (left ? -10 : 10), p.y - 9, space);
      }
    }
    requestAnimationFrame(this.frame);
  };

  private intensity(node: PositionedNode, metric: MetricId, now: number): number {
    if (!this.metrics.includes(metric)) return 0;
    if (node.kind === "library")
      return Math.max(0, ...(this.graph?.libraryModules ?? []).map(id => this.nodeHeat(id, metric, now)));
    return this.nodeHeat(node.id, metric, now);
  }

  private nodeHeat(id: string, metric: MetricId, now: number): number {
    const entry = this.heat[metric].get(id);
    return entry ? entry.amount * Math.max(0, 1 - (now - entry.since) / 2_000) : 0;
  }
}
