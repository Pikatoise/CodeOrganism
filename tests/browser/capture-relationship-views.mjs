import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { StableLayout } from "../../src/web/src/graph/layout.ts";
import { mapFixture } from "./map-fixture.mjs";

const folder = resolve(process.argv[2] ?? "specs/001-live-runtime-map/validation/relationship-captures");
await mkdir(folder, { recursive: true });
const fixture = mapFixture();
const fixtures = [
  ["sparse", [0, 3], 4],
  ["dense", Array.from({ length: 12 }, (_, index) => index), 21],
  ["similar", [0, 1, 3, 4], 10]
];
const browser = await chromium.launch({ channel: "msedge" });
try {
  for (const width of [1440, 640]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    for (const [name, modules, methodLimit] of fixtures) {
      const moduleOrder = new Map(modules.map((id, index) => [id, index]));
      const nodes = fixture.nodes.filter(node => modules.includes(Number((node.parentId ?? node.id).slice(7, 9))) &&
        (node.kind === "module" || Number(node.id.slice(-2)) < methodLimit));
      const ids = new Set(nodes.map(node => node.id));
      const edges = fixture.relationships.filter(edge => ids.has(edge.sourceId) && ids.has(edge.targetId));
      const layout = new StableLayout().project({ sessionId: name, nodes, relationships: edges },
        new Set(nodes.filter(node => node.kind === "module").map(node => node.id)));
      const matrixOrder = nodes.filter(node => node.kind === "method").sort((a, b) => {
        const group = node => Number(node.parentId.slice(7, 9));
        return group(a) % 3 - group(b) % 3 || moduleOrder.get(group(a)) - moduleOrder.get(group(b)) || a.id.localeCompare(b.id);
      }).map(node => node.id);
      await page.setContent('<!doctype html><meta charset="utf-8"><style>' +
        ':root{color:#f8edff;background:#100d17;font:15px system-ui}body{margin:26px}' +
        'h1{font-size:24px;margin:0 0 8px}p{color:#cbb8d8;margin:0 0 18px}' +
        'main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}' +
        'section{border:1px solid #49385d;border-radius:12px;background:#181220;padding:12px}' +
        'h2{margin:0 0 8px;font-size:16px}canvas{display:block;width:100%;height:320px}' +
        '@media(max-width:760px){main{grid-template-columns:1fr}}</style>' +
        '<h1></h1><p></p><main></main>');
      await page.evaluate(({ name, nodes, edges, matrixOrder }) => {
        const selected = edges.find(edge => edge.sourceId === "module-00/00" && edge.targetId === "module-03/00");
        document.querySelector("h1").textContent = { sparse: "Sparse network", dense: "Dense network", similar: "Similar components" }[name];
        document.querySelector("p").textContent = "Selected relationship: Module 0 / HandleRequest0 → Module 3 / HandleRequest0.";
        const index = new Map(nodes.map(node => [node.id, node]));
        const neighbors = new Set([selected.sourceId, selected.targetId]);
        for (const [kind, title] of [["current", "A. Current map"], ["focus", "B. Immediate neighborhood"],
          ["bundles", "C. Module bundles with expanded selection"], ["matrix", "D. Directed adjacency matrix"]]) {
          const panel = document.createElement("section");
          const heading = document.createElement("h2");
          heading.textContent = title;
          const canvas = document.createElement("canvas");
          document.querySelector("main").append(panel);
          panel.append(heading, canvas);
          canvas.width = canvas.clientWidth;
          canvas.height = canvas.clientHeight;
          const ctx = canvas.getContext("2d");
          const { width, height } = canvas;
          const point = id => ({ x: 24 + index.get(id).point.x * (width - 90), y: 24 + index.get(id).point.y * (height - 48) });
          const accent = "#efb6ff";
          if (kind === "matrix") {
            const side = Math.min(width - 50, height - 22);
            const start = (width - side) / 2;
            const size = side / matrixOrder.length;
            const order = new Map(matrixOrder.map((id, row) => [id, row]));
            ctx.fillStyle = "#231830";
            ctx.fillRect(start, 16, side, side);
            ctx.font = "11px system-ui";
            ctx.fillStyle = "#d9bfec";
            ctx.fillText("To →", start, 12);
            ctx.fillText("From", 2, 27);
            ctx.strokeStyle = "#533861";
            for (let row = 1; row < matrixOrder.length; row++) {
              if (index.get(matrixOrder[row - 1]).parentId === index.get(matrixOrder[row]).parentId) continue;
              const offset = row * size;
              ctx.beginPath();
              ctx.moveTo(start + offset, 16);
              ctx.lineTo(start + offset, 16 + side);
              ctx.moveTo(start, 16 + offset);
              ctx.lineTo(start + side, 16 + offset);
              ctx.stroke();
            }
            for (const edge of edges) {
              const column = order.get(edge.targetId), row = order.get(edge.sourceId);
              ctx.fillStyle = edge === selected ? accent : "#9869be";
              ctx.fillRect(start + column * size, 16 + row * size, Math.max(1, size - .25), Math.max(1, size - .25));
            }
            ctx.strokeStyle = accent;
            ctx.strokeRect(start + order.get(selected.targetId) * size - 2,
              16 + order.get(selected.sourceId) * size - 2, size + 4, size + 4);
            continue;
          }
          const links = kind === "bundles" ? new Map() : null;
          const bundleNodes = new Set();
          if (links) {
            for (const edge of edges) {
              const source = index.get(edge.sourceId).parentId, target = index.get(edge.targetId).parentId;
              if (source === target) continue;
              const key = JSON.stringify([source, target]);
              const bundle = links.get(key) ?? { source, target, edges: [] };
              bundle.edges.push(edge);
              links.set(key, bundle);
            }
            for (const bundle of links.values()) {
              const expanded = bundle.edges.includes(selected);
              curve(bundle.source, bundle.target, expanded ? "#bd80e9" : "#79519a", Math.min(8, 1 + Math.sqrt(bundle.edges.length) / 2));
              if (expanded) {
                for (const edge of bundle.edges) {
                  bundleNodes.add(edge.sourceId);
                  bundleNodes.add(edge.targetId);
                  curve(edge.sourceId, edge.targetId, edge === selected ? accent : "#8864a3", edge === selected ? 2 : .8);
                }
              }
            }
          } else {
            for (const edge of edges) {
              const neighbor = neighbors.has(edge.sourceId) || neighbors.has(edge.targetId);
              curve(edge.sourceId, edge.targetId, edge === selected ? accent : kind === "focus"
                ? neighbor ? "#b47bdf" : "#382a47" : "#78558f", edge === selected ? 2.2 : 1);
            }
          }
          for (const node of nodes) {
            const module = node.kind === "module";
            const picked = neighbors.has(node.id);
            if (links && !module && !bundleNodes.has(node.id)) continue;
            const { x, y } = point(node.id);
            ctx.fillStyle = picked ? accent : module ? "#d3adee" : kind === "focus" ? "#6f567e" : "#b38dcf";
            ctx.beginPath();
            ctx.arc(x, y, module ? 4 : picked ? 3.5 : 2, 0, Math.PI * 2);
            ctx.fill();
            if (module || picked) {
              ctx.fillStyle = "#e6cef7";
              ctx.font = "11px system-ui";
              ctx.fillText(module ? node.label.replace("Runtime.", "") : "Request0", x + 5, y - 5);
            }
          }
          function curve(source, target, color, thickness) {
            const a = point(source), b = point(target);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            if (source === target) ctx.bezierCurveTo(a.x - 12, a.y - 18, a.x + 16, a.y - 18, a.x, a.y);
            else {
              const dx = b.x - a.x, dy = b.y - a.y;
              const length = Math.hypot(dx, dy) || 1;
              const bend = Math.min(12, length * .12);
              ctx.quadraticCurveTo((a.x + b.x) / 2 - bend * dy / length, (a.y + b.y) / 2 + bend * dx / length, b.x, b.y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = thickness;
            ctx.stroke();
            if (color === accent && source === selected.sourceId && target === selected.targetId) {
              const angle = Math.atan2(b.y - a.y, b.x - a.x);
              const x = b.x - Math.cos(angle) * 6, y = b.y - Math.sin(angle) * 6;
              ctx.beginPath();
              ctx.moveTo(x - 7 * Math.cos(angle - .4), y - 7 * Math.sin(angle - .4));
              ctx.lineTo(x, y);
              ctx.lineTo(x - 7 * Math.cos(angle + .4), y - 7 * Math.sin(angle + .4));
              ctx.stroke();
            }
          }
        }
      }, { name, nodes: layout.nodes, edges, matrixOrder });
      await page.screenshot({ path: resolve(folder, name + "-" + width + ".png"), fullPage: true });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
