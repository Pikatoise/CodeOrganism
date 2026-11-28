export function mapFixture() {
  const nodes = [];
  const relationships = [];
  const methods = [];
  for (let module = 0; module < 12; module++) {
    const parentId = `module-${String(module).padStart(2, "0")}`;
    nodes.push({ id: parentId, kind: "module", label: `Runtime.Module${module}` });
    methods[module] = [];
    for (let ordinal = 0; ordinal < (module < 10 ? 21 : 20); ordinal++) {
      const id = `${parentId}/${String(ordinal).padStart(2, "0")}`;
      methods[module].push(id);
      nodes.push({ id, kind: "method", parentId, label: `HandleRequest${ordinal}` });
    }
  }
  const link = (sourceId, targetId) => relationships.push({ sourceId, targetId, evidence: "stack-adjacency" });
  for (const [module, group] of methods.entries()) {
    // Interleave three disconnected components in discovery order.
    const neighbor = methods[(module + 3) % methods.length];
    for (const [ordinal, id] of group.entries()) {
      link(id, group[(ordinal + 1) % group.length]);
      link(id, group[ordinal % 7 === 0 ? ordinal : (ordinal + 3) % group.length]);
      link(id, neighbor[ordinal % neighbor.length]);
    }
  }
  return { nodes, relationships };
}
