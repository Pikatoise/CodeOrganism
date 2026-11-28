import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { StableLayout as CurrentLayout } from "../../src/web/src/graph/layout.ts";
import { mapFixture } from "./map-fixture.mjs";

const source = execFileSync("git", ["show", "26f6bc1:src/web/src/graph/layout.ts"], { encoding: "utf8" });
const compiled = stripTypeScriptTypes(source);
const { StableLayout } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function neighbors(ids, relationships) {
  const adjacency = new Map(ids.toSorted().map(id => [id, new Set()]));
  for (const { sourceId, targetId } of relationships) {
    if (sourceId === targetId || !adjacency.has(sourceId) || !adjacency.has(targetId)) continue;
    adjacency.get(sourceId).add(targetId);
    adjacency.get(targetId).add(sourceId);
  }
  return adjacency;
}

function components(adjacency) {
  const remaining = new Set(adjacency.keys());
  const result = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value];
    remaining.delete(queue[0]);
    for (const id of queue) {
      for (const neighbor of [...adjacency.get(id)].sort()) {
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    result.push(queue);
  }
  return result;
}

function cells(ids, bounds) {
  const columns = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / columns);
  const width = bounds.width / columns;
  const height = bounds.height / rows;
  return ids.map((id, index) => ({
    id, x: bounds.x + index % columns * width, y: bounds.y + Math.floor(index / columns) * height, width, height
  }));
}

function clustered(snapshot, force = false) {
  const index = new Map(snapshot.nodes.map(node => [node.id, node]));
  const modules = snapshot.nodes.filter(node => node.kind === "module").map(node => node.id);
  const parent = id => index.get(id)?.parentId ?? id;
  const moduleLinks = snapshot.relationships.map(({ sourceId, targetId }) =>
    ({ sourceId: parent(sourceId), targetId: parent(targetId) }));
  const groups = components(neighbors(modules, moduleLinks));
  const positions = new Map();
  const home = new Map();
  let offset = .04;
  for (const group of groups) {
    const width = .92 * group.length / modules.length;
    for (const cell of cells(group, { x: offset + .016, y: .09, width: width - .032, height: .76 })) {
      const center = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
      positions.set(cell.id, center);
      const ids = snapshot.nodes.filter(node => node.parentId === cell.id).map(node => node.id);
      const order = components(neighbors(ids, snapshot.relationships)).flat();
      for (const slot of cells(order, {
        x: cell.x + cell.width * .09, y: cell.y + cell.height * .13, width: cell.width * .82, height: cell.height * .74
      })) {
        const point = { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 };
        if (Math.abs(point.y - center.y) < cell.height * .06) point.y += cell.height * .045;
        positions.set(slot.id, point);
        home.set(slot.id, point);
      }
    }
    offset += width;
  }
  if (force) {
    const adjacency = neighbors([...home.keys()], snapshot.relationships);
    const ids = [...home.keys()];
    for (let iteration = 0; iteration < 24; iteration++) {
      const next = new Map();
      for (const id of ids) {
        const point = positions.get(id);
        const origin = home.get(id);
        let dx = (origin.x - point.x) * .12, dy = (origin.y - point.y) * .12;
        for (const adjacent of adjacency.get(id)) {
          const other = positions.get(adjacent);
          dx += (other.x - point.x) * .025;
          dy += (other.y - point.y) * .025;
        }
        for (const otherId of ids) {
          if (id === otherId) continue;
          const other = positions.get(otherId);
          const x = point.x - other.x, y = point.y - other.y;
          const distance = Math.hypot(x, y);
          if (distance > 0 && distance < .035) {
            const repel = (.035 - distance) / distance * .09;
            dx += x * repel;
            dy += y * repel;
          }
        }
        next.set(id, {
          x: origin.x + Math.max(-.025, Math.min(.025, point.x + dx - origin.x)),
          y: origin.y + Math.max(-.025, Math.min(.025, point.y + dy - origin.y))
        });
      }
      for (const [id, point] of next) positions.set(id, point);
    }
  }
  return positions;
}

function baseline(snapshot, layout = new StableLayout()) {
  const expanded = new Set(snapshot.nodes.filter(node => node.kind === "module").map(node => node.id));
  return new Map(layout.project(snapshot, expanded).nodes.map(node => [node.id, node.point]));
}

function measure(snapshot, positions, successor, width, height) {
  const xy = point => ({ x: point.x * width, y: point.y * height });
  const segments = snapshot.relationships.filter(edge => edge.sourceId !== edge.targetId).map(edge =>
    [xy(positions.get(edge.sourceId)), xy(positions.get(edge.targetId))]);
  const left = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const length = segments.reduce((sum, [a, b]) => sum + Math.hypot(a.x - b.x, a.y - b.y), 0);
  let crossings = 0;
  for (const [i, [a, b]] of segments.entries()) {
    for (let j = 0; j < i; j++) {
      const [c, d] = segments[j];
      if (left(a, b, c) * left(a, b, d) < 0 && left(c, d, a) * left(c, d, b) < 0) crossings++;
    }
  }
  const labels = snapshot.nodes.map(node => {
    const point = xy(positions.get(node.id));
    const onLeft = point.x > width * .71;
    const space = (onLeft ? point.x : width - point.x) - 16;
    if (space <= 28) return null;
    const size = Math.min(space, node.label.length * 7);
    return { x: point.x + (onLeft ? -10 - size : 10), y: point.y - 21, size };
  }).filter(Boolean);
  let overlaps = 0;
  for (const [i, a] of labels.entries()) {
    for (let j = 0; j < i; j++) {
      const b = labels[j];
      if (Math.abs(a.y - b.y) < 14 && a.x < b.x + b.size && b.x < a.x + a.size) overlaps++;
    }
  }
  const displacements = [...positions].map(([id, point]) => {
    const next = successor.get(id);
    return Math.hypot((point.x - next.x) * width, (point.y - next.y) * height);
  }).sort((a, b) => a - b);
  return {
    edgeMean: Math.round(length / segments.length), crossings, overlaps,
    displacementP95: Math.round(displacements[Math.ceil(displacements.length * .95) - 1]),
    displacementMax: Math.round(displacements.at(-1))
  };
}

const dense = { ...mapFixture(), sessionId: "layout" };
const sparseNodes = dense.nodes.filter(node => !node.parentId || /\/0[0-2]$/.test(node.id));
const sparseIds = new Set(sparseNodes.map(node => node.id));
const sparse = { ...dense, nodes: sparseNodes, relationships: dense.relationships.filter(edge =>
  sparseIds.has(edge.sourceId) && sparseIds.has(edge.targetId)) };
for (const [fixture, snapshot] of [["sparse", sparse], ["dense", dense]]) {
  const update = { ...snapshot, relationships: [...snapshot.relationships,
    { sourceId: "module-00/00", targetId: "module-01/00", evidence: "stack-adjacency" }] };
  for (const [name, placement] of [["baseline", baseline], ["clustered", clustered], ["bounded-force", value => clustered(value, true)]]) {
    const layout = new StableLayout();
    const points = name === "baseline" ? placement(snapshot, layout) : placement(snapshot);
    const next = name === "baseline" ? placement(update, layout) : placement(update);
    for (const [viewport, width, height] of [[1440, 1040, 549], [640, 591, 450]]) {
      console.log(JSON.stringify({ fixture, name, viewport, ...measure(snapshot, points, next, width, height) }));
    }
  }
  const layout = new CurrentLayout();
  const points = baseline(snapshot, layout);
  const reordered = { ...snapshot, nodes: snapshot.nodes.toReversed(), relationships: snapshot.relationships.toReversed() };
  assert.deepEqual(baseline(reordered, new CurrentLayout()), points);
  layout.project(snapshot, new Set());
  assert.deepEqual(baseline({ ...snapshot, version: 2 }, layout), points);
  const next = baseline(update, layout);
  for (const [id, point] of points) {
    const after = next.get(id);
    assert.ok(Math.hypot(after.x - point.x, after.y - point.y) <= .045000001);
  }
  for (const [viewport, width, height] of [[1440, 1040, 549], [640, 591, 450]]) {
    console.log(JSON.stringify({ fixture, name: "current", viewport, ...measure(snapshot, points, next, width, height) }));
  }
}
