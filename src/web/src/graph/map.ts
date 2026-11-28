import type { Point, PositionedNode, Projection, Relationship, Snapshot } from "./layout";
import { nodeLabel } from "../language";
import { defaultGraphics, type GraphicsQuality } from "../settings";
import { metricDetails, metricIds, toRate, type MetricId } from "./metrics";

type Flash = { strength: number; since: number };
type Heat = { amount: number; since: number; rate: number; baseline: number; flash?: Flash };
type Curve = readonly [Point, Point, Point, Point];
type DrawNode = { node: PositionedNode; point: Point; branch: number };
type DrawEdge = {
  edge: Relationship; source: DrawNode; target: DrawNode; curve: Curve; path: Path2D;
  band: number; candidate: number; heat: number;
};
type Geometry = {
  nodes: DrawNode[]; edges: DrawEdge[]; core: Path2D; bands: Path2D[];
  sums: Float64Array; counts: Uint32Array; quotas: Uint32Array;
  rasterOrigin?: Point;
};
type LabelText = { text: string; width: number };
type Label = LabelText & { node: DrawNode; x: number; y: number; left: boolean };
const hoverTolerance = 8;
const fadeDuration = 2_000;
const flashDuration = 1_400;
const modeDuration = 150;
const bandCount = 5;
const colorNames = ["label", "label-emphasis", "glow", "active", "hover", "branch", "neighbor", "calls", "cpu", "node", "node-light", "ring"] as const;
const rasterThreshold = 96;
const rasterPadding = 96;
export const zoomStep = 1.25;
const zoomExpansion = Math.sqrt(50);
const minZoom = .55 / zoomExpansion;
const maxZoom = 3.5 * zoomExpansion;

export class RuntimeMap {
  private readonly context: CanvasRenderingContext2D;
  private readonly heat: Record<MetricId, Map<string, Heat>> = { cpu: new Map(), allocation: new Map(), calls: new Map() };
  private metrics: readonly MetricId[] = ["cpu"];
  private channelWeights: Record<MetricId, number> = { cpu: 1, allocation: 0, calls: 0 };
  private modeChange?: { since: number; from: Record<MetricId, number> };
  private graph?: Projection;
  private selected?: string;
  private selectedEdge?: Relationship;
  private size = { x: 0, y: 0 };
  private shift = { x: 0, y: 0 };
  private scale = 1;
  private quality: GraphicsQuality = defaultGraphics;
  private colors = readColors();
  private zoom = 1;
  private frozenAt?: number;
  private sessionId = "";
  private pointer?: { x: number; y: number; dx: number; dy: number; moved: boolean };
  private hover?: Point;
  private locked = false;
  private frameRequest = 0;
  private expirationTimer = 0;
  private nextExpiration = Infinity;
  private geometry?: Geometry;
  private coreRaster?: HTMLCanvasElement;
  private over?: DrawEdge;
  private neighborhood?: Path2D;
  private viewChanged = true;
  private labels: Label[] = [];
  private labelText = new Map<string, LabelText>();
  private activeUntil: Record<MetricId, number> = { cpu: 0, allocation: 0, calls: 0 };

  constructor(private readonly canvas: HTMLCanvasElement,
    private readonly select: (node: PositionedNode, fromBranch?: boolean) => void,
    private readonly onZoom: (scale: number) => void) {
    this.context = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("pointerdown", event => {
      if (this.locked || event.button !== 0 || !event.isPrimary) return;
      this.hover = undefined;
      this.pointer = { x: event.clientX, y: event.clientY, dx: this.shift.x, dy: this.shift.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
      this.invalidateView();
    });
    canvas.addEventListener("pointermove", event => {
      if (this.locked || !event.isPrimary) return;
      if (!this.pointer) {
        if (event.pointerType !== "touch") {
          this.hover = this.localPoint(event);
          this.invalidateView();
        }
        return;
      }
      const dx = event.clientX - this.pointer.x, dy = event.clientY - this.pointer.y;
      this.pointer.moved ||= Math.hypot(dx, dy) > 4;
      if (this.pointer.moved) {
        this.shift = { x: this.pointer.dx + dx, y: this.pointer.dy + dy };
        this.invalidateView();
      }
    });
    canvas.addEventListener("pointerup", event => {
      if (this.pointer && !this.pointer.moved) {
        this.pick(this.localPoint(event));
      }
      this.pointer = undefined;
    });
    canvas.addEventListener("pointerleave", () => { this.hover = undefined; this.invalidateView(); });
    canvas.addEventListener("lostpointercapture", () => { this.pointer = undefined; });
    canvas.addEventListener("wheel", event => {
      if (this.locked) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.size.y : 1;
      const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
      const anchor = this.localPoint(event);
      if (!this.pointer) this.hover = anchor;
      this.zoomBy(Math.exp(-delta * .0014), anchor);
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      if (this.locked) return;
      const offsets: Record<string, Point> = { ArrowLeft: { x: -30, y: 0 }, ArrowRight: { x: 30, y: 0 },
        ArrowUp: { x: 0, y: -30 }, ArrowDown: { x: 0, y: 30 } };
      const offset = offsets[event.key];
      if (offset) {
        event.preventDefault();
        this.shift = { x: this.shift.x + offset.x, y: this.shift.y + offset.y };
        this.invalidateView();
      } else if (event.key === "+" || event.key === "-") {
        event.preventDefault();
        this.zoomBy(event.key === "+" ? zoomStep : 1 / zoomStep);
      }
    });
  }

  update(snapshot: Snapshot) {
    if (this.sessionId !== snapshot.sessionId) {
      this.sessionId = snapshot.sessionId;
      this.selectedEdge = undefined;
      for (const metric of metricIds) {
        this.heat[metric].clear();
        this.activeUntil[metric] = 0;
      }
      this.reset();
    }
    if (snapshot.state !== "live") return;
    const duration = (snapshot.endMs ?? 0) - (snapshot.startMs ?? 0);
    if (duration <= 0) return;
    const now = performance.now();
    for (const measure of snapshot.measurements) {
      const metric = measure.metric;
      if (metric === "cpu" || metric === "allocation" || metric === "calls") {
        if (measure.value == null || (metric === "calls" && !measure.complete)) {
          if (this.heat[metric].delete(measure.nodeId) && this.channelWeights[metric]) this.schedule();
          continue;
        }
        const rate = toRate(measure.value, duration);
        const amount = Math.min(1, metricDetails[metric].strength(rate));
        const previous = this.heat[metric].get(measure.nodeId);
        const recent = previous && now - previous.since <= fadeDuration * 2 ? previous : undefined;
        const spike = rate > 0 && (!recent || recent.rate === 0 ||
          (rate > recent.baseline * 1.3 && rate > recent.rate * 1.15));
        const baseline = recent ? recent.baseline * .75 + rate * .25 : rate;
        const flash = spike ? { strength: Math.max(.52, amount), since: now } : previous?.flash;
        this.heat[metric].set(measure.nodeId, { amount, since: now, rate, baseline, flash });
        if (amount > 0 || spike) {
          this.activeUntil[metric] = Math.max(this.activeUntil[metric], now + fadeDuration);
        }
        if (this.channelWeights[metric] && (amount > 0 || spike || previous?.amount)) this.schedule();
      }
    }
  }

  show(graph: Projection, selected: string | undefined, metrics: readonly MetricId[]) {
    if (graph !== this.graph) {
      const hovered = this.over?.edge;
      if (hovered && !graph.edges.some(edge => edge.sourceId === hovered.sourceId &&
          edge.targetId === hovered.targetId && edge.evidence === hovered.evidence)) this.hover = undefined;
      if (this.selectedEdge) this.selectedEdge = graph.edges.find(edge => this.isSelectedEdge(edge));
      this.geometry = undefined;
      this.labelText.clear();
      this.invalidateView();
    }
    if (selected !== this.selected) {
      if (selected !== this.selectedEdge?.targetId) this.selectedEdge = undefined;
      this.invalidateView();
    }
    if (metrics.length !== this.metrics.length || metrics.some((metric, index) => metric !== this.metrics[index])) {
      const now = performance.now();
      this.updateChannelWeights(now);
      this.modeChange = { since: now, from: { ...this.channelWeights } };
      this.schedule();
    }
    this.graph = graph;
    this.selected = selected;
    this.metrics = metrics;
  }
  pause(paused: boolean) {
    this.frozenAt = paused ? performance.now() : undefined;
    this.schedule();
  }
  setLocked(locked: boolean) {
    this.locked = locked;
    this.pointer = this.hover = undefined;
    this.invalidateView();
  }
  zoomBy(factor: number, anchor?: Point) {
    this.setZoom(this.zoom * factor, anchor);
  }
  setZoom(scale: number, anchor = { x: this.size.x / 2, y: this.size.y / 2 }) {
    const next = Math.max(minZoom, Math.min(maxZoom, scale));
    if (this.zoom !== next) {
      const ratio = next / this.zoom;
      const x = anchor.x - this.size.x / 2, y = anchor.y - this.size.y / 2;
      this.shift = { x: x - (x - this.shift.x) * ratio, y: y - (y - this.shift.y) * ratio };
      this.geometry = undefined;
      this.zoom = next;
      this.invalidateView();
    }
    this.onZoom(this.zoom);
  }
  reset() {
    this.zoom = 1;
    this.shift = { x: 0, y: 0 };
    this.geometry = undefined;
    this.invalidateView();
    this.onZoom(this.zoom);
  }
  focus(id: string) {
    const found = this.graph?.nodes.find(node => node.id === id);
    if (!found) return;
    this.selectedEdge = undefined;
    this.shift = { x: (0.5 - found.point.x) * this.size.x * this.zoom,
      y: (0.5 - found.point.y) * this.size.y * this.zoom };
    this.invalidateView();
  }

  private pick(point: Point) {
    if (!this.graph) return;
    const drawing = this.geometry ??= this.buildGeometry(this.graph);
    const now = this.frozenAt ?? performance.now();
    let distance = Infinity;
    let picked: PositionedNode | undefined;
    for (const { node, point: hit } of drawing.nodes) {
      const next = Math.hypot(point.x - hit.x - this.shift.x, point.y - hit.y - this.shift.y);
      if (next <= this.nodeRadius(node, now) + 5 && next < distance) { distance = next; picked = node; }
    }
    const branch = picked ? undefined : this.edgeAt(drawing, point);
    this.selectedEdge = branch?.edge;
    this.invalidateView();
    if (picked) this.select(picked);
    else if (branch) this.select(branch.target.node, true);
  }

  private localPoint(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  configure(quality: GraphicsQuality) {
    this.quality = quality;
    this.colors = readColors();
    this.resize();
  }

  private resize() {
    const size = { x: this.canvas.clientWidth, y: this.canvas.clientHeight };
    if (size.x && size.y && this.size.x && this.size.y) {
      this.shift = { x: this.shift.x * size.x / this.size.x, y: this.shift.y * size.y / this.size.y };
    }
    this.size = size;
    this.scale = Math.min(devicePixelRatio || 1, this.quality.pixelRatio);
    this.canvas.width = this.size.x * this.scale;
    this.canvas.height = this.size.y * this.scale;
    this.labelText.clear();
    this.geometry = undefined;
    this.invalidateView();
  }

  private screen(point: Point) {
    return { x: (.5 + (point.x - .5) * this.zoom) * this.size.x,
      y: (.5 + (point.y - .5) * this.zoom) * this.size.y };
  }

  private invalidateView() { this.viewChanged = true; this.schedule(); }

  private schedule() {
    if (this.expirationTimer) {
      window.clearTimeout(this.expirationTimer);
      this.expirationTimer = 0;
    }
    if (!this.frameRequest) this.frameRequest = requestAnimationFrame(this.frame);
  }

  private readonly frame = (frameTime: number) => {
    this.frameRequest = 0;
    this.nextExpiration = Infinity;
    const context = this.context;
    const now = this.frozenAt ?? frameTime;
    context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    context.clearRect(0, 0, this.size.x, this.size.y);
    if (!this.graph) return;
    this.updateChannelWeights(frameTime);

    const drawing = this.geometry ??= this.buildGeometry(this.graph);
    if (this.viewChanged) {
      this.over = this.hover && this.edgeAt(drawing, this.hover);
      const focus = this.over?.edge ?? this.selectedEdge;
      this.neighborhood = undefined;
      if (focus) {
        const neighbors = new Path2D();
        const endpoints = new Set([focus.sourceId, focus.targetId]);
        for (const item of drawing.edges) {
          if (endpoints.has(item.edge.sourceId) || endpoints.has(item.edge.targetId)) neighbors.addPath(item.path);
        }
        this.neighborhood = neighbors;
      }
      this.labels = this.placeLabels(drawing);
      this.viewChanged = false;
    }
    context.translate(this.shift.x, this.shift.y);
    this.drawBranches(drawing, now);
    for (const node of drawing.nodes) {
      const x = node.point.x + this.shift.x, y = node.point.y + this.shift.y;
      if (x >= -72 && x <= this.size.x + 72 && y >= -72 && y <= this.size.y + 72) this.drawNode(node, now);
    }
    for (const label of this.labels) {
      const node = label.node.node;
      context.font = labelFont(node);
      context.textAlign = label.left ? "right" : "left";
      context.fillStyle = this.emphasized(node.id) ? this.colors["label-emphasis"] : this.colors.label;
      context.fillText(label.text, label.x, label.y + 12);
    }
    if (this.modeChange) this.schedule();
    else if (this.frozenAt === undefined) {
      if (!this.quality.animate && Number.isFinite(this.nextExpiration)) {
        this.expirationTimer = window.setTimeout(() => this.schedule(), Math.max(1, this.nextExpiration - performance.now()));
      } else if (this.quality.animate && this.metrics.some(metric => this.activeUntil[metric] > frameTime)) this.schedule();
    }
  };

  private buildGeometry(graph: Projection): Geometry {
    const nodes = graph.nodes.map(node => ({ node, point: this.screen(node.point), branch: 0 }));
    const index = new Map(nodes.map(node => [node.node.id, node]));
    const core = new Path2D();
    const edges: DrawEdge[] = [];
    const targetsBySource = new Map<string, Set<string>>();
    for (const { sourceId, targetId } of graph.edges) {
      let targets = targetsBySource.get(sourceId);
      if (!targets) targetsBySource.set(sourceId, targets = new Set());
      targets.add(targetId);
    }
    for (const edge of graph.edges) {
      const source = index.get(edge.sourceId), target = index.get(edge.targetId);
      if (!source || !target) continue;
      const a = source.point, b = target.point;
      const curve: Curve = source === target
        ? [a, { x: a.x - 26, y: a.y - 43 }, { x: a.x + 33, y: a.y - 36 }, a]
        : branchCurve(a, b, targetsBySource.get(edge.targetId)?.has(edge.sourceId) === true);
      const path = new Path2D();
      const [, c1, c2] = curve;
      path.moveTo(a.x, a.y);
      path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      core.addPath(path);
      edges.push({ edge, source, target, curve, path, band: -1, candidate: -1, heat: 0 });
    }
    return {
      nodes, edges, core, bands: [], sums: new Float64Array(bandCount), counts: new Uint32Array(bandCount),
      quotas: new Uint32Array(bandCount)
    };
  }

  private drawBranches(drawing: Geometry, now: number) {
    const context = this.context;
    drawing.sums.fill(0);
    drawing.counts.fill(0);
    drawing.quotas.fill(0);
    for (const item of drawing.nodes) item.branch = this.branchIntensity(item.node, now);
    for (const item of drawing.edges) {
      item.heat = Math.max(item.source.branch, item.target.branch);
      item.candidate = item.heat > .008 ? Math.min(bandCount - 1, Math.floor(item.heat * bandCount)) : -1;
      if (item.candidate >= 0) drawing.quotas[item.candidate]++;
    }
    // On dense maps, preserve a quiet core for every branch and reserve the halo for the strongest bands.
    let remaining = this.quality.glowLimit;
    for (let band = bandCount - 1; band >= 0; band--) {
      drawing.quotas[band] = Math.min(remaining, drawing.quotas[band]);
      remaining -= drawing.quotas[band];
    }
    let changed = false;
    for (const item of drawing.edges) {
      const band = item.candidate >= 0 && drawing.quotas[item.candidate] ? item.candidate : -1;
      changed ||= band !== item.band;
      item.band = band;
      if (band < 0) continue;
      drawing.quotas[band]--;
      drawing.sums[band] += item.heat;
      drawing.counts[band]++;
    }
    if (changed) {
      drawing.bands = Array.from({ length: bandCount }, () => new Path2D());
      for (const item of drawing.edges) if (item.band >= 0) drawing.bands[item.band].addPath(item.path);
    }
    context.strokeStyle = this.colors.glow;
    for (let band = 0; band < bandCount; band++) {
      if (!drawing.counts[band]) continue;
      const path = drawing.bands[band];
      const heat = drawing.sums[band] / drawing.counts[band];
      for (const pass of this.quality.halo) {
        context.globalAlpha = heat * pass.opacity;
        context.lineWidth = pass.width;
        context.stroke(path);
      }
    }
    context.globalAlpha = this.neighborhood ? .38 : 1;
    this.drawCore(drawing);
    if (this.neighborhood) {
      context.globalAlpha = .76;
      context.strokeStyle = this.colors.neighbor;
      context.lineWidth = 1.25;
      context.stroke(this.neighborhood);
    }
    context.strokeStyle = this.colors.active;
    context.lineWidth = 1;
    for (let band = 0; band < bandCount; band++) {
      if (!drawing.counts[band]) continue;
      context.globalAlpha = drawing.sums[band] / drawing.counts[band] * .72;
      context.stroke(drawing.bands[band]);
    }
    context.globalAlpha = 1;
    const selected = this.selectedEdge && drawing.edges.find(item => this.isSelectedEdge(item.edge));
    if (selected) {
      context.strokeStyle = this.colors.ring;
      context.lineWidth = 2;
      context.stroke(selected.path);
      this.drawDirection(selected.curve);
    }
    if (this.over) {
      context.strokeStyle = this.colors.hover;
      context.lineWidth = 2.5;
      context.stroke(this.over.path);
      this.drawDirection(this.over.curve);
    }
  }

  private drawDirection(curve: Curve) {
    const [a, b, c, d] = curve;
    const x = (a.x + 3 * b.x + 3 * c.x + d.x) / 8;
    const y = (a.y + 3 * b.y + 3 * c.y + d.y) / 8;
    const angle = Math.atan2(d.y + c.y - b.y - a.y, d.x + c.x - b.x - a.x);
    this.context.beginPath();
    this.context.moveTo(x - 6 * Math.cos(angle - .52), y - 6 * Math.sin(angle - .52));
    this.context.lineTo(x, y);
    this.context.lineTo(x - 6 * Math.cos(angle + .52), y - 6 * Math.sin(angle + .52));
    this.context.stroke();
  }

  private drawCore(drawing: Geometry) {
    if (drawing.edges.length <= rasterThreshold) {
      this.context.strokeStyle = this.colors.branch;
      this.context.lineWidth = .85;
      this.context.stroke(drawing.core);
      return;
    }
    const layer = this.coreRaster ??= document.createElement("canvas");
    if (!drawing.rasterOrigin || Math.abs(this.shift.x - drawing.rasterOrigin.x) > rasterPadding ||
        Math.abs(this.shift.y - drawing.rasterOrigin.y) > rasterPadding) {
      layer.width = this.size.x + 2 * rasterPadding;
      layer.height = this.size.y + 2 * rasterPadding;
      const raster = layer.getContext("2d")!;
      drawing.rasterOrigin = this.shift;
      raster.translate(rasterPadding + this.shift.x, rasterPadding + this.shift.y);
      raster.strokeStyle = this.colors.branch;
      raster.lineWidth = 1;
      raster.stroke(drawing.core);
    }
    this.context.drawImage(layer, -rasterPadding - drawing.rasterOrigin.x, -rasterPadding - drawing.rasterOrigin.y);
  }

  private drawNode(item: DrawNode, now: number) {
    const { node, point } = item;
    const context = this.context;
    const heat = this.intensity(node, "cpu", now);
    const calls = Math.max(this.intensity(node, "calls", now), .6 * this.emphasis(node, "calls", now));
    const radius = this.nodeRadius(node, now);
    if (calls > .005) this.drawCallGlow(point, radius, calls);
    const pulse = this.emphasis(node, "cpu", now);
    const flash = Math.max(pulse, this.emphasis(node, "allocation", now), this.emphasis(node, "calls", now));
    if (pulse > .01) {
      context.globalAlpha = .63 * pulse;
      context.fillStyle = this.colors.cpu;
      this.circle(point, radius + 3 + 6 * pulse);
      context.fill();
    }
    context.globalAlpha = .65 + .35 * Math.max(heat, flash);
    context.fillStyle = this.colors.node;
    this.circle(point, radius);
    context.fill();
    const activity = Math.max(heat, calls, flash);
    if (this.quality.nodeLight && activity > .01) {
      context.globalAlpha = this.quality.nodeLight * activity;
      context.fillStyle = this.colors["node-light"];
      this.circle({ x: point.x - radius * .2, y: point.y - radius * .22 }, radius * .53);
      context.fill();
    }
    context.globalAlpha = 1;
    if (this.emphasized(node.id)) {
      this.circle(point, radius + 7);
      context.strokeStyle = this.colors.ring;
      context.lineWidth = 1;
      context.stroke();
    }
  }

  private drawCallGlow(point: Point, radius: number, calls: number) {
    const context = this.context;
    const color = this.colors.calls;
    let outer = radius + 3 + 6 * calls;
    context.globalAlpha = .21 * calls;
    context.fillStyle = color;
    if (this.quality.nodeGlow !== "flat") {
      const layered = this.quality.nodeGlow === "layered";
      outer = radius + (layered ? 10 + 28 * calls : 6 + 19 * calls);
      const glow = context.createRadialGradient(point.x, point.y, radius, point.x, point.y, outer);
      glow.addColorStop(0, color);
      if (layered) {
        glow.addColorStop(.23, color + "bf");
        glow.addColorStop(.56, color + "35");
      }
      glow.addColorStop(1, color + "00");
      context.globalAlpha = (layered ? 1 : .8) * calls;
      context.fillStyle = glow;
    }
    this.circle(point, outer);
    context.fill();
  }

  private circle(point: Point, radius: number) {
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  }

  private emphasized(id: string) {
    return id === this.selected || id === this.selectedEdge?.sourceId ||
      id === this.over?.edge.sourceId || id === this.over?.edge.targetId;
  }

  private nodeRadius(node: PositionedNode, now: number) {
    return (node.kind === "module" || node.kind === "library" ? 6 : 3.5) +
      14 * Math.max(this.intensity(node, "allocation", now), .18 * this.emphasis(node, "allocation", now));
  }

  private isSelectedEdge(edge: Relationship) {
    return this.selectedEdge?.sourceId === edge.sourceId && this.selectedEdge.targetId === edge.targetId &&
      this.selectedEdge.evidence === edge.evidence;
  }

  private placeLabels(drawing: Geometry) {
    const labels: Label[] = [];
    const ordered = [
      ...drawing.nodes.filter(item => this.emphasized(item.node.id)),
      ...drawing.nodes.filter(item => !this.emphasized(item.node.id) && item.node.kind !== "method"),
      ...drawing.nodes.filter(item => !this.emphasized(item.node.id) && item.node.kind === "method")
    ];
    for (const item of ordered) {
      const { point, node } = item;
      const x = point.x + this.shift.x, y = point.y + this.shift.y;
      if (x < 0 || x > this.size.x || y < 22 || y > this.size.y) continue;
      const left = x > this.size.x * .71;
      const space = (left ? x : this.size.x - x) - 16;
      if (space <= 28) continue;
      let text = this.labelText.get(node.id);
      if (!text) {
        const limit = Math.min(this.size.x * .24, node.kind === "method" ? 175 : 215);
        text = this.fitLabel(node, limit);
        this.labelText.set(node.id, text);
      }
      if (text.width > space) text = this.fitLabel(node, space);
      const label = { ...text, node: item, left, x: point.x + (left ? -10 : 10), y: point.y - 21 };
      const start = label.left ? label.x - text.width : label.x;
      if (labels.some(other => {
        if (Math.abs(other.y - label.y) >= 15) return false;
        const otherStart = other.left ? other.x - other.width : other.x;
        return start < otherStart + other.width + 4 && otherStart < start + label.width + 4;
      })) continue;
      labels.push(label);
    }
    return labels;
  }

  private fitLabel(node: PositionedNode, limit: number): LabelText {
    this.context.font = labelFont(node);
    const measure = (text: string) => this.context.measureText(text).width;
    const label = nodeLabel(node);
    const width = measure(label);
    if (width <= limit) return { text: label, width };
    const chars = Array.from(label);
    let start = 0, end = chars.length;
    while (end - start > 1) {
      const middle = Math.floor((start + end) / 2);
      if (measure(chars.slice(0, middle).join("") + "…") <= limit) start = middle;
      else end = middle;
    }
    const text = chars.slice(0, start).join("") + "…";
    return { text, width: measure(text) };
  }

  private edgeAt(drawing: Geometry, screen: Point): DrawEdge | undefined {
    const point = { x: screen.x - this.shift.x, y: screen.y - this.shift.y };
    let nearest: DrawEdge | undefined;
    let distance = hoverTolerance ** 2;
    for (const item of drawing.edges) {
      const next = curveDistance(point, item.curve, distance);
      if (next < distance) { distance = next; nearest = item; }
    }
    return nearest;
  }

  private updateChannelWeights(now: number) {
    const change = this.modeChange;
    if (!change) return;
    const progress = this.quality.animate ? Math.max(0, Math.min(1, (now - change.since) / modeDuration)) : 1;
    for (const metric of metricIds) {
      const target = this.metrics.includes(metric) ? 1 : 0;
      this.channelWeights[metric] = change.from[metric] + (target - change.from[metric]) * progress;
    }
    if (progress === 1) this.modeChange = undefined;
  }

  private intensity(node: PositionedNode, metric: MetricId, now: number): number {
    const weight = this.channelWeights[metric];
    if (!weight) return 0;
    if (node.kind !== "library") return weight * this.nodeHeat(node.id, metric, now);
    let strongest = 0;
    for (const id of this.graph?.libraryModules ?? []) strongest = Math.max(strongest, this.nodeHeat(id, metric, now));
    return weight * strongest;
  }

  private nodeHeat(id: string, metric: MetricId, now: number): number {
    const entry = this.heat[metric].get(id);
    if (!entry) return 0;
    const age = Math.max(0, now - entry.since);
    if (this.quality.animate) return entry.amount * Math.max(0, 1 - age / fadeDuration);
    if (!entry.amount || age >= fadeDuration) return 0;
    this.nextExpiration = Math.min(this.nextExpiration, entry.since + fadeDuration);
    return entry.amount;
  }

  private branchIntensity(node: PositionedNode, now: number): number {
    return Math.max(.45 * this.intensity(node, "cpu", now), this.emphasis(node, "cpu", now));
  }

  private emphasis(node: PositionedNode, metric: MetricId, now: number) {
    const weight = this.channelWeights[metric];
    if (!weight) return 0;
    if (node.kind !== "library") return weight * this.nodeFlash(node.id, metric, now);
    let strongest = 0;
    for (const id of this.graph?.libraryModules ?? []) strongest = Math.max(strongest, this.nodeFlash(id, metric, now));
    return weight * strongest;
  }

  private nodeFlash(id: string, metric: MetricId, now: number) {
    const flash = this.heat[metric].get(id)?.flash;
    if (!flash) return 0;
    const age = Math.max(0, now - flash.since);
    if (age >= flashDuration) return 0;
    if (!this.quality.animate) {
      this.nextExpiration = Math.min(this.nextExpiration, flash.since + flashDuration);
      return flash.strength;
    }
    const pulse = metric === "cpu" ? .72 + .28 * Math.cos(age / 58) : 1;
    return flash.strength * (1 - age / flashDuration) * pulse;
  }
}

function branchCurve(a: Point, b: Point, reciprocal: boolean): Curve {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const bend = Math.min(length * (reciprocal ? .16 : .08), reciprocal ? 22 : 12);
  const offsetX = -dy / (length || 1) * bend, offsetY = dx / (length || 1) * bend;
  return [
    a,
    { x: a.x + dx / 3 + offsetX, y: a.y + dy / 3 + offsetY },
    { x: a.x + 2 * dx / 3 + offsetX, y: a.y + 2 * dy / 3 + offsetY },
    b
  ];
}

function labelFont(node: PositionedNode) {
  return node.kind === "method" ? "12px system-ui" : "600 13px system-ui";
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  const entries = colorNames.map(name => [name, style.getPropertyValue(`--graph-${name}`).trim()]);
  return Object.fromEntries(entries) as Record<typeof colorNames[number], string>;
}

function curveDistance(point: Point, curve: Curve, limit: number) {
  const [a, b, c, d] = curve;
  if (point.x < Math.min(a.x, b.x, c.x, d.x) - hoverTolerance ||
      point.x > Math.max(a.x, b.x, c.x, d.x) + hoverTolerance ||
      point.y < Math.min(a.y, b.y, c.y, d.y) - hoverTolerance ||
      point.y > Math.max(a.y, b.y, c.y, d.y) + hoverTolerance) return limit;
  let x = a.x, y = a.y;
  for (let i = 1; i <= 20; i++) {
    const t = i / 20, s = 1 - t;
    const nextX = s ** 3 * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t ** 3 * d.x;
    const nextY = s ** 3 * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t ** 3 * d.y;
    const dx = nextX - x, dy = nextY - y;
    const ratio = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1)));
    limit = Math.min(limit, (point.x - x - ratio * dx) ** 2 + (point.y - y - ratio * dy) ** 2);
    x = nextX;
    y = nextY;
  }
  return limit;
}
