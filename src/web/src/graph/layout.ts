export type GraphNode = {
  id: string; kind: "module" | "method" | "unresolved" | "library"; label: string;
  parentId?: string | null; library?: string | null;
};
export type Relationship = { sourceId: string; targetId: string; evidence?: string };
export type Measurement = { nodeId: string; metric: string; value: number | null; complete: boolean; quality: string };
export type MethodPeak = { reading: Measurement; startMs: number; endMs: number };
export type Snapshot = {
  sessionId: string; version: number; state: "connecting" | "live" | "ended" | "failed";
  source: { label: string; target?: string | null }; startMs: number | null; endMs: number | null;
  nodes: GraphNode[]; relationships: Relationship[]; measurements: Measurement[];
  methodPeaks?: MethodPeak[];
  capabilities: { metric: string; method: string; unit: string; quality: string }[];
  loss: { kind: string; metric?: string | null }[]; gaps: number; lastUpdate: string; endReason?: string | null;
};
export type Point = { x: number; y: number };
export type PositionedNode = GraphNode & { point: Point; expandable: boolean };
export type Projection = { nodes: PositionedNode[]; edges: Relationship[]; libraryId: string; libraryModules: string[] };

export const isLibrary = (node: GraphNode) => node.library === "framework" || node.library === "third-party";

export class StableLayout {
  private positions = new Map<string, Point>();
  private topology = "";
  private metadata = "";
  private visibility = "";
  private projected?: Projection;
  private session = "";

  project(snapshot: Snapshot, expanded: ReadonlySet<string>): Projection {
    if (this.session !== snapshot.sessionId) {
      this.session = snapshot.sessionId;
      this.positions.clear();
      this.topology = "";
      this.projected = undefined;
    }

    const nodeKeys = snapshot.nodes.map(node => JSON.stringify([node.id, node.kind, node.parentId ?? null])).sort();
    const edgeKeys = snapshot.relationships.map(edge => JSON.stringify([edge.sourceId, edge.targetId, edge.evidence])).sort();
    const topology = JSON.stringify([nodeKeys, edgeKeys]);
    const metadata = JSON.stringify(snapshot.nodes.map(node => JSON.stringify([node.id, node.label, node.library])).sort());
    const visibility = JSON.stringify([...expanded].sort());
    if (this.projected && topology === this.topology && metadata === this.metadata && visibility === this.visibility) {
      return this.projected;
    }
    const index = new Map(snapshot.nodes.map(node => [node.id, node]));
    const modules = snapshot.nodes.filter(node => node.kind === "module");
    const libraryModules = modules.filter(isLibrary).map(node => node.id);
    const librarySet = new Set(libraryModules);
    let libraryId = "@view:libraries";
    while (index.has(libraryId)) libraryId += ":";
    const library: GraphNode = { id: libraryId, kind: "library", label: "Libraries" };
    if (topology !== this.topology) {
      const targets = placeNodes(index, modules, snapshot.relationships);
      for (const [id, target] of targets) {
        const previous = this.positions.get(id);
        if (!previous) continue;
        const dx = target.x - previous.x, dy = target.y - previous.y;
        const fraction = Math.min(1, .045 / Math.hypot(dx, dy));
        targets.set(id, { x: previous.x + dx * fraction, y: previous.y + dy * fraction });
      }
      this.positions = targets;
    }
    this.topology = topology;
    this.metadata = metadata;
    this.visibility = visibility;

    const availableChildren = new Set(snapshot.nodes.flatMap(node => node.parentId ? [node.parentId] : []));

    const visible = new Map<string, PositionedNode>();
    for (const node of [...snapshot.nodes, ...(libraryModules.length ? [library] : [])]) {
      if (node.kind === "module" && librarySet.has(node.id) && !expanded.has(libraryId)) continue;
      if (node.parentId && (!expanded.has(node.parentId) ||
          (librarySet.has(node.parentId) && !expanded.has(libraryId)))) continue;

      visible.set(node.id, { ...node, point: this.positions.get(node.id) ?? { x: .15, y: .91 },
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

    this.projected = { nodes: [...visible.values()], edges, libraryId, libraryModules };
    return this.projected;
  }
}

type Adjacency = Map<string, Set<string>>;
type Cell = Point & { width: number; height: number };

function placeNodes(index: Map<string, GraphNode>, modules: GraphNode[], edges: Relationship[]) {
  const moduleLinks: Adjacency = new Map(modules.map(node => [node.id, new Set()]));
  const children = new Map(modules.map(node => [node.id, new Map<string, Set<string>>()]));
  const positions = new Map<string, Point>();
  const roots: string[] = [];
  for (const node of index.values()) {
    if (node.kind === "module") continue;
    const siblings = node.parentId ? children.get(node.parentId) : undefined;
    if (siblings) siblings.set(node.id, new Set());
    else roots.push(node.id);
  }
  for (const edge of edges) {
    const from = index.get(edge.sourceId), to = index.get(edge.targetId);
    if (!from || !to) continue;
    const a = from.parentId ?? from.id, b = to.parentId ?? to.id;
    if (a === b) {
      const siblings = children.get(a);
      if (siblings) link(siblings, from.id, to.id);
    } else link(moduleLinks, a, b);
  }

  let offset = .04;
  for (const group of components(moduleLinks)) {
    const width = .92 * group.length / modules.length;
    const margin = Math.min(.016, width * .12);
    placeGrid(group, { x: offset + margin, y: .09, width: width - 2 * margin, height: .76 }, (id, cell) => {
      const center = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
      positions.set(id, center);
      const ordered = components(children.get(id)!).flat();
      placeGrid(ordered, {
        x: cell.x + cell.width * .09, y: cell.y + cell.height * .13,
        width: cell.width * .82, height: cell.height * .74
      }, (child, slot) => {
        const point = { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 };
        if (ordered.length === 1) point.y -= cell.height * .21;
        else if (Math.abs(point.y - center.y) < cell.height * .06) point.y += cell.height * .075;
        positions.set(child, point);
      });
    });
    offset += width;
  }
  roots.sort().forEach((id, i) => positions.set(id, { x: .84 - i * .52 / roots.length, y: .91 }));
  return positions;
}

function link(adjacency: Adjacency, a: string, b: string) {
  if (a === b || !adjacency.has(a) || !adjacency.has(b)) return;
  adjacency.get(a)!.add(b);
  adjacency.get(b)!.add(a);
}

function components(adjacency: Adjacency): string[][] {
  const remaining = new Set([...adjacency.keys()].sort());
  const groups: string[][] = [];
  for (const id of remaining) {
    const group = [id];
    remaining.delete(id);
    for (const current of group) {
      for (const neighbor of [...adjacency.get(current)!].sort()) {
        if (remaining.delete(neighbor)) group.push(neighbor);
      }
    }
    groups.push(group);
  }
  return groups;
}

function placeGrid(ids: string[], bounds: Cell, place: (id: string, cell: Cell) => void) {
  if (!ids.length) return;
  const columns = Math.ceil(Math.sqrt(ids.length));
  const width = bounds.width / columns;
  const height = bounds.height / Math.ceil(ids.length / columns);
  ids.forEach((id, i) => place(id, {
    x: bounds.x + i % columns * width, y: bounds.y + Math.floor(i / columns) * height, width, height
  }));
}
