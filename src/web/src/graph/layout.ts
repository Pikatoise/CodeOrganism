export type GraphNode = {
  id: string; kind: "module" | "method" | "unresolved" | "library"; label: string;
  parentId?: string | null; library?: string | null;
};
export type Relationship = { sourceId: string; targetId: string; evidence?: string };
export type Measurement = { nodeId: string; metric: string; value: number | null; complete: boolean; quality: string };
export type Snapshot = {
  sessionId: string; version: number; state: "connecting" | "live" | "ended" | "failed";
  source: { label: string; target?: string | null }; startMs: number | null; endMs: number | null;
  nodes: GraphNode[]; relationships: Relationship[]; measurements: Measurement[];
  capabilities: { metric: string; method: string; unit: string; quality: string }[];
  loss: { kind: string; metric?: string | null }[]; gaps: number; lastUpdate: string; endReason?: string | null;
};
export type Point = { x: number; y: number };
export type PositionedNode = GraphNode & { point: Point; expandable: boolean };
export type Projection = { nodes: PositionedNode[]; edges: Relationship[]; libraryId: string; libraryModules: string[] };

const golden = 2.39996323;
const anchors = [[.48, .51], [.72, .32], [.24, .32], [.73, .72], [.25, .72], [.49, .22]];
export const isLibrary = (node: GraphNode) => node.library === "framework" || node.library === "third-party";

export class StableLayout {
  private positions = new Map<string, Point>();
  private children = new Map<string, number>();
  private modules = 0;
  private session = "";

  project(snapshot: Snapshot, expanded: ReadonlySet<string>): Projection {
    if (this.session !== snapshot.sessionId) {
      this.session = snapshot.sessionId;
      this.positions.clear();
      this.children.clear();
      this.modules = 0;
    }

    const index = new Map(snapshot.nodes.map(node => [node.id, node]));
    const modules = snapshot.nodes.filter(node => node.kind === "module");
    const libraryModules = modules.filter(isLibrary).map(node => node.id);
    const librarySet = new Set(libraryModules);
    let libraryId = "@view:libraries";
    while (index.has(libraryId)) libraryId += ":";
    const library: GraphNode = { id: libraryId, kind: "library", label: "Libraries" };
    const availableChildren = new Set(snapshot.nodes.flatMap(node => node.parentId ? [node.parentId] : []));
    for (const node of modules) this.point(node);
    if (libraryModules.length) this.point(library);

    const visible = new Map<string, PositionedNode>();
    for (const node of [...snapshot.nodes, ...(libraryModules.length ? [library] : [])]) {
      if (node.kind === "module" && librarySet.has(node.id) && !expanded.has(libraryId)) continue;
      if (node.parentId && (!expanded.has(node.parentId) ||
          (librarySet.has(node.parentId) && !expanded.has(libraryId)))) continue;

      visible.set(node.id, { ...node, point: this.point(node),
        expandable: node.kind === "library" || availableChildren.has(node.id) });
    }

    const toVisible = (id: string) => {
      if (visible.has(id)) return id;
      const parent = index.get(id)?.parentId ?? id;
      return visible.has(parent) ? parent : librarySet.has(parent) ? libraryId : undefined;
    };
    const seen = new Set<string>();
    const edges: Relationship[] = [];
    for (const edge of snapshot.relationships) {
      const sourceId = toVisible(edge.sourceId);
      const targetId = toVisible(edge.targetId);
      if (!sourceId || !targetId || (sourceId === targetId && !(
        edge.sourceId === edge.targetId && sourceId === edge.sourceId))) continue;
      const key = JSON.stringify([sourceId, targetId]);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ ...edge, sourceId, targetId });
    }

    return { nodes: [...visible.values()], edges, libraryId, libraryModules };
  }

  private point(node: GraphNode): Point {
    const existing = this.positions.get(node.id);
    if (existing) return existing;
    const parent = node.parentId ? this.positions.get(node.parentId) : undefined;
    let point: Point;
    if (parent && node.parentId) {
      const slot = this.children.get(node.parentId) ?? 0;
      this.children.set(node.parentId, slot + 1);
      const angle = golden * slot + (hash(node.parentId) * Math.PI * 2);
      const radius = Math.min(.33, .11 + Math.sqrt(slot) * .04);
      point = { x: clamp(parent.x + Math.cos(angle) * radius), y: clamp(parent.y + Math.sin(angle) * radius) };
    } else if (node.kind === "library") {
      point = { x: .18, y: .82 };
    } else if (node.kind === "unresolved") {
      point = { x: .83, y: .83 };
    } else {
      const slot = this.modules++;
      const anchor = anchors[slot];
      const angle = slot * golden;
      const radius = Math.min(.38, .16 + Math.sqrt(slot) * .022);
      point = anchor ? { x: anchor[0], y: anchor[1] }
        : { x: .49 + Math.cos(angle) * radius, y: .50 + Math.sin(angle) * radius };
    }
    this.positions.set(node.id, point);
    return point;
  }
}

function hash(value: string) {
  let result = 2_166_136_261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16_777_619);
  return (result >>> 0) / 2 ** 32;
}

function clamp(value: number) {
  return Math.max(.08, Math.min(.87, value));
}
