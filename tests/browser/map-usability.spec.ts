import { expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { test } from "./host-fixture";

if (process.env.CODEORGANISM_TEST_SOFTWARE === "1") {
  test.use({ launchOptions: { args: ["--disable-gpu", "--disable-gpu-compositing"] } });
}

const modules = [
  { id: "alpha", kind: "module", label: "Orders" },
  { id: "isolated", kind: "module", label: "Background" },
  { id: "beta", kind: "module", label: "Catalog" }
];
const methods = Array.from({ length: 15 }, (_, i) => ({
  id: `work-${i}`, kind: "method", label: i === 3 ? "ProcessOrderWithLongGenericArgumentNames".repeat(3) : `HandleOrder${i}`,
  parentId: i < 11 ? "alpha" : "beta"
}));
const nodes = [...modules, ...methods];
const relationships = [
  { sourceId: "work-0", targetId: "work-11", evidence: "stack-adjacency" },
  { sourceId: "work-11", targetId: "work-0", evidence: "stack-adjacency" },
  { sourceId: "work-0", targetId: "work-0", evidence: "stack-adjacency" }
];
const capabilities = [
  { metric: "cpu", quality: "estimated", unit: "ms", method: "windows-etw-on-cpu-sampling" },
  { metric: "calls", quality: "exact", unit: "count", method: "dotnet-eventpipe-entry-checkpoints" }
];

async function installStream(page: Page) {
  await page.addInitScript(() => {
    const instrument = window as any;
    instrument.mapDraw = { points: [], hovered: false, neighborhood: false, selectedBranch: false, active: 0, curves: [] };
    window.EventSource = class extends EventTarget {
      onopen?: () => void;
      onerror?: () => void;
      constructor() {
        super();
        instrument.pushSnapshot = (data: object) => this.dispatchEvent(new MessageEvent("snapshot", { data: JSON.stringify(data) }));
        instrument.dropStream = () => this.onerror?.();
        queueMicrotask(() => this.onopen?.());
      }
    } as any;
    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect, arc = prototype.arc, stroke = prototype.stroke;
    prototype.clearRect = function (...args) {
      if (this.canvas.id === "runtime-map") {
        instrument.mapDraw = { points: [], hovered: false, neighborhood: false, selectedBranch: false, active: 0, curves: instrument.mapDraw.curves };
      }
      return clear.apply(this, args);
    };
    const bezier = Path2D.prototype.bezierCurveTo;
    Path2D.prototype.bezierCurveTo = function (...args) {
      instrument.mapDraw.curves.push(args);
      return bezier.apply(this, args);
    };
    prototype.arc = function (...args) {
      if (this.canvas.id === "runtime-map" && [3.5, 6].includes(args[2])) {
        const transform = this.getTransform();
        instrument.mapDraw.points.push({ x: args[0] + transform.e / transform.a, y: args[1] + transform.f / transform.d });
      }
      return arc.apply(this, args);
    };
    prototype.stroke = function (...args: [Path2D?]) {
      if (this.canvas.id === "runtime-map" && this.strokeStyle === "#f3ddff") instrument.mapDraw.hovered = true;
      if (this.canvas.id === "runtime-map" && this.strokeStyle === "#c29ae2") instrument.mapDraw.neighborhood = true;
      if (this.canvas.id === "runtime-map" && args[0] && this.strokeStyle === "#edc8ff") instrument.mapDraw.selectedBranch = true;
      if (this.canvas.id === "runtime-map" && this.strokeStyle === "#e9c5ff") {
        instrument.mapDraw.active = Math.max(instrument.mapDraw.active, this.globalAlpha);
      }
      return args[0] ? stroke.call(this, args[0]) : stroke.call(this);
    };
  });
}

function update(page: Page, version: number, extra: object = {}) {
  return page.evaluate(snapshot => (window as any).pushSnapshot(snapshot), {
    sessionId: "fixture", version, state: "live", source: { label: "Map fixture", target: "PID 42" },
    startMs: (version - 1) * 1000, endMs: version * 1000, lastUpdate: new Date().toISOString(),
    nodes, relationships, capabilities,
    measurements: nodes.flatMap((node, i) => [
      { nodeId: node.id, metric: "cpu", value: (i * 100 + version * 401) % 1200, quality: "estimated", complete: true },
      { nodeId: node.id, metric: "calls", value: i * 350, quality: "exact", complete: true }
    ]),
    loss: [], gaps: 0, ...extra
  });
}

const draw = (page: Page) => page.evaluate(() => (window as any).mapDraw as {
  points: { x: number; y: number }[]; hovered: boolean; neighborhood: boolean; selectedBranch: boolean; active: number; curves: number[][];
});

for (const width of [1440, 640]) {
  test(`session ranking and movable fullscreen panels at ${width}px`, async ({ page, host }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installStream(page);
    await page.goto(host.url);
    const fixture = nodes.map(node => node.id === "work-3" ? { ...node, label: "LongMethodName".repeat(125) } : node);
    const peak = (value: number, startMs = 0) => ({
      reading: { nodeId: "work-0", metric: "cpu", value, quality: "estimated", complete: true },
      startMs, endMs: startMs + 1_000
    });
    await update(page, 1, { nodes: fixture, methodPeaks: [peak(300)] });
    const ranking = page.locator("#cpu-ranking");
    const groups = page.locator("#groups");
    const group = groups.locator('[data-node="alpha"]');
    await group.press("Enter");
    await expect(groups.locator('[data-node="work-10"]')).toBeVisible();
    expect(await groups.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await page.getByLabel("Ranking view").selectOption("methods");
    await expect(ranking.locator("button")).toHaveCount(methods.length);
    await expect(ranking.locator('[data-node="work-3"]')).toContainText("Unavailable");
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByRole("heading", { name: "Top methods" })).toBeVisible();
    await expect(ranking.locator('[data-node="work-0"]')).toContainText("300 ms/s");
    await page.evaluate(() => (window as any).dropStream());
    await update(page, 4, { nodes: fixture, methodPeaks: [peak(800, 2_000)], measurements: [] });
    await expect(ranking.locator('[data-node="work-0"]')).toContainText("800 ms/s");
    await expect(ranking.locator("button")).toHaveCount(methods.length);

    await ranking.locator('[data-node="work-3"]').press("Enter");
    const inspector = page.locator("#details");
    await inspector.locator("summary").press("Enter");
    const selected = await page.locator("#selection-name").textContent();
    const zoom = page.getByLabel("Zoom percentage");
    await zoom.fill("160%");
    await zoom.press("Enter");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const toggle = page.locator("#fullscreen-map");
    await toggle.press("Enter");
    await expect(toggle).toHaveAccessibleName("Exit fullscreen map");
    const cards = page.locator("#fullscreen-panels > .inspector > .inspection-panel");
    await expect(cards).toHaveCount(3);
    if (process.env.CODEORGANISM_MAP_CAPTURES) {
      await page.screenshot({ path: resolve(process.env.CODEORGANISM_MAP_CAPTURES, `fullscreen-${width}.png`) });
    }
    const sizes = () => cards.evaluateAll(elements => elements.map(element => {
      const { width, height } = element.getBoundingClientRect();
      return [width, height];
    }));
    const openSizes = await sizes();
    expect(openSizes.every(size => size.join() === openSizes[0].join())).toBe(true);
    for (let i = 0; i < 3; i++) {
      const card = cards.nth(i);
      const body = card.locator(".panel-content");
      await expect.poll(() => body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await body.evaluate(element => { element.scrollTop = 40; });
      expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const positions = () => cards.evaluateAll(elements => elements.map(element => {
        const { x, y } = element.getBoundingClientRect();
        return [x, y];
      }));
      const before = await positions();
      const handle = card.locator(".panel-move");
      await handle.focus();
      if (i === 0) {
        const bounds = (await handle.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 + 28, bounds.y + bounds.height / 2 + 36);
        await page.mouse.up();
      } else {
        const layerLeft = (await page.locator("#fullscreen-panels").boundingBox())!.x;
        await handle.press(before[i][0] > layerLeft + 1 ? "ArrowLeft" : "ArrowRight");
      }
      const after = await positions();
      expect(after[i]).not.toEqual(before[i]);
      expect(after.filter((_, index) => index !== i)).toEqual(before.filter((_, index) => index !== i));
      await card.locator("summary").press("Enter");
      await expect(handle).toBeVisible();
    }
    const closedSizes = await sizes();
    expect(closedSizes.every(size => size.join() === closedSizes[0].join())).toBe(true);
    expect(closedSizes[0][1]).toBeLessThan(openSizes[0][1]);
    await cards.nth(1).locator("summary").press("Enter");
    await expect(page.locator("#selection-name")).toHaveText(selected!);
    await expect(zoom).toHaveValue("160%");
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    const canvasBox = (await page.locator("#runtime-map").boundingBox())!;
    await page.mouse.move(canvasBox.x + 24, canvasBox.y + canvasBox.height - 24);
    await page.mouse.wheel(0, -50);
    await expect(zoom).not.toHaveValue("160%");
    await zoom.fill("160%");
    await zoom.press("Enter");
    await toggle.press("Escape");
    await expect(toggle).toHaveAccessibleName("Open fullscreen map");
    await expect(toggle).toBeFocused();
    await expect(page.locator("main > .inspector #details")).toHaveJSProperty("open", true);
    await expect(page.locator("main > .inspector #ranking-panel")).toHaveJSProperty("open", false);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName("Exit fullscreen map");
    await toggle.click();
    await expect(toggle).toHaveAccessibleName("Open fullscreen map");
    await page.getByRole("button", { name: "Resume" }).click();
    await page.locator("#ranking-panel summary").press("Enter");
    await update(page, 1, { sessionId: "next", nodes: modules, relationships: [], methodPeaks: [] });
    await expect(ranking.locator("button")).toHaveCount(0);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>(".map-area")!.requestFullscreen = () => Promise.reject(new Error("Unavailable"));
    });
    await toggle.click();
    await expect(page.locator("#fullscreen-status")).toHaveText("Fullscreen is unavailable in this browser.");
    await expect(page.locator("main > .inspector")).toBeVisible();
  });
}

const viewports = [1440, 640].flatMap(width => (["no-preference", "reduce"] as const).map(motion => [width, motion] as const));
for (const [width, reducedMotion] of viewports) {
  test(`map navigation, activity and workspace at ${width}px with ${reducedMotion} motion`, async ({ page, host }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await installStream(page);
    await page.goto(host.url);
    const canvas = page.locator("#runtime-map");
    const ranking = page.locator("#ranking-panel summary");
    const groups = page.locator("#groups-panel summary");
    const inspector = page.locator("#details");
    expect(await page.evaluate(() => {
      const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
      const inspection = document.querySelector(".inspector")!.getBoundingClientRect();
      return workspace.bottom < inspection.top && workspace.x === inspection.x &&
        workspace.width === inspection.width && document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
    await update(page, 1);
    await expect(page.locator("#source-status")).toContainText("Map fixture");
    await expect.poll(async () => (await draw(page)).points.length).toBe(3);
    const overview = (await draw(page)).points;
    const distance = (a: { x: number; y: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(distance(overview[0], overview[2])).toBeLessThan(distance(overview[0], overview[1]));
    const initialBounds = await canvas.boundingBox();

    await page.locator('#groups button[data-node="alpha"]').press("Enter");
    await page.locator('#groups button[data-node="beta"]').press("Enter");
    await page.getByLabel("Ranking view").selectOption("methods");
    await expect.poll(async () => (await draw(page)).points.length).toBe(nodes.length);
    const expanded = (await draw(page)).points;
    const first = expanded[3];
    const other = expanded[14];
    const dx = other.x - first.x, dy = other.y - first.y;
    const length = Math.hypot(dx, dy);
    const [forward, backward] = (await draw(page)).curves.slice(-3);
    for (const [from, curve, direction] of [[first, forward, 1], [other, backward, -1]] as const) {
      const x = curve[0] - from.x, y = curve[1] - from.y;
      expect((x * dx + y * dy) * direction / length ** 2).toBeCloseTo(1 / 3);
      expect((dx * y - dy * x) * direction / length).toBeCloseTo(Math.min(length * .16, 22));
    }
    await canvas.scrollIntoViewIfNeeded();
    const rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + first.x + 2.6, rect.y + first.y - 29.6);
    await expect.poll(async () => (await draw(page)).hovered).toBe(true);
    await expect.poll(async () => (await draw(page)).neighborhood).toBe(true);
    await page.mouse.click(rect.x + first.x + 2.6, rect.y + first.y - 29.6);
    await expect.poll(async () => (await draw(page)).selectedBranch).toBe(true);
    await expect(inspector).toHaveJSProperty("open", false);
    if (process.env.CODEORGANISM_MAP_CAPTURES && reducedMotion === "no-preference") {
      await canvas.screenshot({ path: resolve(process.env.CODEORGANISM_MAP_CAPTURES, `neighborhood-${width}.png`) });
    }
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => distance((await draw(page)).points[0], expanded[0])).toBeGreaterThan(2);
    const zoomed = (await draw(page)).points;
    const zoom = page.getByLabel("Zoom percentage");
    await expect(zoom).toHaveValue("115.03%");
    expect(distance(zoomed[3], { x: first.x + 2.6, y: first.y - 29.6 }) /
      distance(first, { x: first.x + 2.6, y: first.y - 29.6 })).toBeCloseTo(Math.exp(.14), 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + first.x + 40, rect.y + first.y);
    await expect.poll(async () => (await draw(page)).hovered).toBe(false);
    await page.mouse.up();
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(async () => (await draw(page)).points).toEqual(expanded);
    await canvas.scrollIntoViewIfNeeded();
    const resetBounds = (await canvas.boundingBox())!;
    await page.mouse.click(resetBounds.x + first.x, resetBounds.y + first.y);
    await expect(inspector).toHaveJSProperty("open", false);
    await expect(page.locator("#selection-name")).toHaveText("Orders / HandleOrder0");
    const loopTarget = page.locator('#cpu-ranking button[data-node="work-0"]');
    async function selectLoopAtCenter() {
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2 + 2.6, box.y + box.height / 2 - 29.6);
      await expect.poll(async () => (await draw(page)).selectedBranch).toBe(true);
    }
    await loopTarget.click();
    await zoom.fill("1%");
    await zoom.press("Enter");
    await expect(zoom).toHaveValue("7.78%");
    await selectLoopAtCenter();
    await loopTarget.click();
    await zoom.fill("5000");
    await zoom.press("Tab");
    await expect(zoom).toHaveValue("2474.87%");
    await selectLoopAtCenter();
    await zoom.fill("");
    await zoom.press("Enter");
    await expect(zoom).toHaveValue("2474.87%");
    await zoom.fill("Invalid");
    await zoom.press("Enter");
    await expect(zoom).toHaveValue("2474.87%");
    await zoom.fill("80,5%");
    await zoom.press("Enter");
    await expect(zoom).toHaveValue("80.5%");
    await canvas.press("+");
    await expect(zoom).toHaveValue("100.63%");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(zoom).toHaveValue("80.5%");
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(zoom).toHaveValue("100%");
    await expect.poll(async () => (await draw(page)).points).toEqual(expanded);

    await ranking.press("Enter");
    await groups.press("Enter");
    await update(page, 2, { source: { label: "Unusually long process name ".repeat(12), target: "PID 42" },
      loss: [{ kind: "source-events" }], gaps: 123 });
    await expect(page.locator("#ranking-panel")).toHaveJSProperty("open", false);
    await expect(page.locator("#groups-panel")).toHaveJSProperty("open", false);
    await expect(page.locator("#coverage")).toBeHidden();
    await expect.poll(() => canvas.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
    })).toEqual(initialBounds);
    expect((await draw(page)).points).toEqual(expanded);
    await ranking.press("Enter");
    await groups.press("Enter");
    await expect(page.locator("#coverage")).toBeVisible();
    await expect(page.locator("#coverage")).toContainText("123 interval gaps");
    const rank = page.locator("#cpu-ranking button").first();
    const focused = await rank.getAttribute("data-node");
    await rank.focus();
    const list = page.locator("#cpu-ranking");
    await expect(list.locator("button")).toHaveCount(methods.length);
    const scrollTop = await list.evaluate(element => {
      element.scrollTop = 30;
      return element.scrollTop;
    });
    await update(page, 3);
    await expect(rank).not.toHaveAttribute("data-node", focused!);
    await expect(page.locator(`#cpu-ranking button[data-node="${focused}"]`)).toBeFocused();
    expect(await list.evaluate(element => element.scrollTop)).toBe(scrollTop);
    await expect.poll(async () => (await draw(page)).active).toBeGreaterThan(.04);
    if (reducedMotion === "no-preference") {
      await expect.poll(async () => (await draw(page)).active, { timeout: 3_000 }).toBeLessThan(.04);
      await update(page, 4);
      await expect.poll(async () => (await draw(page)).active).toBeGreaterThan(.04);
    }
    await page.getByRole("button", { name: "Combined" }).click();
    await page.getByLabel("Rank by").selectOption("calls");
    await ranking.press("Enter");
    await page.getByRole("button", { name: "CPU", exact: true }).click();
    await page.getByRole("button", { name: "Combined" }).click();
    await expect(page.locator("#ranking-panel")).toHaveJSProperty("open", false);
    await ranking.press("Enter");
    await expect(page.getByLabel("Rank by")).toHaveValue("calls");
    await page.locator("#cpu-ranking button").first().click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frozen = await draw(page);
    await update(page, 5);
    await page.waitForTimeout(250);
    expect((await draw(page)).active).toBe(frozen.active);

    if (process.env.CODEORGANISM_MAP_CAPTURES) {
      await page.evaluate(() => {
        document.querySelector("#groups")!.scrollTop = 0;
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: resolve(process.env.CODEORGANISM_MAP_CAPTURES, `expanded-${width}-${reducedMotion}.png`), fullPage: true
      });
    }
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(async () => (await draw(page)).points).toEqual(expanded);
    await canvas.scrollIntoViewIfNeeded();
    const pausedBounds = (await canvas.boundingBox())!;
    await page.mouse.move(pausedBounds.x + first.x + 2.6, pausedBounds.y + first.y - 29.6);
    await expect.poll(async () => (await draw(page)).hovered).toBe(true);
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => distance((await draw(page)).points[0], expanded[0])).toBeGreaterThan(2);
    const pausedOverview = (await draw(page)).points.slice(0, 3);
    await page.getByRole("button", { name: "Collapse all" }).press("Enter");
    await expect(page.getByRole("button", { name: "Collapse all" })).toBeDisabled();
    await expect(canvas).toBeFocused();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.locator("#selection-name")).toHaveText("Catalog");
    await expect.poll(async () => (await draw(page)).points).toEqual(pausedOverview);
  });

  test(`pending attach locks only the workspace at ${width}px with ${reducedMotion} motion`, async ({ page, host }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await installStream(page);
    let control: { state: string; pid?: number; reason?: string } = { state: "idle" };
    let outcome: "success" | "reject" | "restricted" | "exited" | "loss" = "success";
    await page.route("**/api/view/v1/control", route => route.fulfill({ json: { csrf: "test", status: control } }));
    await page.route("**/api/view/v1/attach", async route => {
      const { pid } = route.request().postDataJSON();
      await new Promise(done => setTimeout(done, 220));
      if (outcome === "reject") return route.fulfill({ status: 409, json: { message: "The source is busy." } });
      control = outcome === "restricted" ? { state: "restricted", pid, reason: "Elevation was denied." }
        : outcome === "exited" ? { state: "exited", pid, reason: "The process is no longer running." }
        : { state: "connecting", pid };
      return route.fulfill({ status: 202, json: {} });
    });
    await page.goto(host.url);
    await update(page, 1, { state: "ended" });
    const pid = page.getByLabel("Or enter PID");
    const attach = page.getByRole("button", { name: "Attach", exact: true });
    const overlay = page.locator("#attach-overlay");
    const workspace = page.locator("#map-content");
    const detach = page.getByRole("button", { name: "Detach" });
    await pid.fill("42");
    await attach.click();
    await expect(overlay).toBeVisible();
    await expect(workspace).toHaveJSProperty("inert", true);
    await expect(page.locator(".inspector")).toHaveJSProperty("inert", true);
    await expect(page.locator("#attach-progress")).toBeFocused();
    await update(page, 2); // Previous session, including a reused PID.
    await expect(detach).toBeEnabled();
    await expect(workspace).toHaveJSProperty("inert", true);
    await update(page, 1, { sessionId: "other", source: { label: "Other PID", target: "PID 43" } });
    await expect(workspace).toHaveJSProperty("inert", true);
    await update(page, 1, { sessionId: "requested", state: "connecting" });
    await expect(workspace).toHaveJSProperty("inert", true);
    await update(page, 2, { sessionId: "requested", source: { label: "Requested PID", target: "PID 42" } });
    await expect(overlay).toBeHidden();
    await expect(workspace).toHaveJSProperty("inert", false);
    await expect(detach).toBeFocused();
    await expect(page.locator("#source-status")).toContainText("Requested PID");

    control = { state: "idle" };
    await update(page, 3, { sessionId: "requested", state: "ended" });
    await pid.fill("43");
    await attach.click();
    await expect(workspace).toHaveJSProperty("inert", true);
    await expect(detach).toBeEnabled();
    await update(page, 1, { sessionId: "different", source: { label: "Different PID", target: "PID 43" } });
    await expect(overlay).toBeHidden();
    await expect(page.locator("#source-status")).toContainText("Different PID");

    for (const [failure, message] of [
      ["reject", "The source is busy."], ["restricted", "Elevation was denied."],
      ["exited", "The process is no longer running."], ["loss", ""]
    ] as const) {
      outcome = failure;
      control = { state: "idle" };
      await update(page, 2, { sessionId: "different", state: "ended" });
      await pid.fill("45");
      await attach.click();
      await expect(workspace).toHaveJSProperty("inert", true);
      if (failure === "loss") {
        await expect(detach).toBeEnabled();
        await page.evaluate(() => (window as any).dropStream());
      } else {
        await expect(page.locator("#control-message")).toHaveText(message);
      }
      await expect(overlay).toBeHidden();
      await expect(workspace).toHaveJSProperty("inert", false);
    }
  });
}

test("a tiny increase from zero lights the branch in every motion mode", async ({ page, host }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installStream(page);
  await page.goto(host.url);
  const reading = (version: number, value: number) => update(page, version, {
    measurements: [{ nodeId: "alpha", metric: "cpu", value, quality: "estimated", complete: true }]
  });
  await reading(1, 0);
  await expect(page.locator("#cpu-ranking")).toContainText("0 ms/s");
  await reading(2, .0001);
  await expect.poll(async () => (await draw(page)).active).toBeGreaterThan(.15);
  await expect.poll(async () => (await draw(page)).active).toBeLessThan(.04);

  await page.locator("#open-settings").click();
  await page.locator("#graphics-quality").selectOption("low");
  await page.locator("#close-settings").click();
  await reading(3, 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await reading(4, .0001);
  await expect.poll(async () => (await draw(page)).active).toBeGreaterThan(.3);
  const highlight = (await draw(page)).active;
  await page.waitForTimeout(300);
  expect((await draw(page)).active).toBe(highlight);
  await expect.poll(async () => (await draw(page)).active).toBeLessThan(.04);
});
