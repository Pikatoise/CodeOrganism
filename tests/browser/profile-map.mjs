import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mapFixture } from "./map-fixture.mjs";

const output = resolve(process.argv[2] || "src/web/coverage/map-profile");
const assets = resolve(process.env.MAP_PROFILE_ASSETS ?? fileURLToPath(new URL("../../src/web/dist/", import.meta.url)));
const seconds = Number(process.env.MAP_PROFILE_SECONDS ?? 5);
const refreshRate = Number(process.env.MAP_PROFILE_HZ ?? 60);
const beforeWheelChange = process.env.MAP_PROFILE_BASELINE === "1";
const offscreen = process.env.MAP_PROFILE_OFFSCREEN === "1";
const presets = process.env.MAP_PROFILE_PRESETS?.split(",") ?? [null];
if (presets.some(preset => preset !== null && !["low", "balanced", "high"].includes(preset))) {
  throw new Error("MAP_PROFILE_PRESETS must contain low, balanced or high.");
}
const fixture = mapFixture();
const clients = new Set();
let version = 0;
let snapshot;
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
const files = new Map();
for (const directory of ["", "assets"]) {
  for (const entry of await readdir(resolve(assets, directory), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(assets, directory, entry.name);
    files.set(path, await readFile(path));
  }
}
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/api/view/v1/events") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    clients.add(response);
    response.on("close", () => clients.delete(response));
    return;
  }
  if (path === "/api/view/v1/control" || path === "/api/view/v1/processes") {
    response.setHeader("Content-Type", "application/json");
    response.end(path.endsWith("/control") ? '{"csrf":"fixture","status":{"state":"idle"}}' : "[]");
    return;
  }
  try {
    const file = resolve(assets, path === "/" ? "index.html" : path.slice(1));
    if (!file.startsWith(resolve(assets) + sep)) throw new Error("Outside assets");
    const body = files.get(file);
    if (!body) throw new Error("Missing asset");
    response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

function publish(active) {
  version++;
  snapshot = {
    ...fixture, sessionId: "profile", version, state: "live", source: { label: "Map benchmark" },
    startMs: (version - 1) * 1000, endMs: version * 1000, lastUpdate: new Date().toISOString(),
    capabilities: [{ metric: "cpu", method: "sample-weighted", unit: "ms", quality: "estimated" }],
    measurements: fixture.nodes.map((node, index) => ({
      nodeId: node.id, metric: "cpu", quality: "estimated", complete: true,
      value: active ? (index * 29 + version * 37) % 240 : 0
    })), loss: [], gaps: 0
  };
  for (const client of clients) client.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function instrument(offscreen) {
  const data = { frames: [], longTasks: [], input: [], canvasDraws: 0, drawnLabels: 0 };
  let recording = false;
  let previousFrame;
  window.beginProfile = phase => {
    performance.mark(`map-${phase}-start`);
    data.frames.length = data.longTasks.length = data.input.length = 0;
    data.canvasDraws = data.drawnLabels = 0;
    previousFrame = undefined;
    recording = true;
  };
  window.endProfile = phase => {
    recording = false;
    performance.mark(`map-${phase}-end`);
    return data;
  };
  new PerformanceObserver(list => {
    if (recording) data.longTasks.push(...list.getEntries().map(entry => entry.duration));
  }).observe({ type: "longtask" });
  const frame = time => {
    if (recording && previousFrame !== undefined) data.frames.push(time - previousFrame);
    previousFrame = time;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let pending;
  function paint() {
    if (recording) {
      data.canvasDraws++;
      data.drawnLabels = 0;
    }
    if (recording && pending) {
      const input = pending;
      pending = undefined;
      // The next frame begins after this draw's rendering opportunity.
      requestAnimationFrame(() => {
        if (recording) data.input.push({ type: input.type, ms: performance.now() - input.timeStamp });
      });
    }
  }
  const clearRect = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.id === "runtime-map") paint();
    return clearRect.apply(this, args);
  };
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (...args) {
    if (recording && this.canvas.id === "runtime-map") data.drawnLabels++;
    return fillText.apply(this, args);
  };
  if (offscreen) {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type !== "2d" || this.id !== "runtime-map") return getContext.call(this, type, ...args);
      const canvas = this;
      const surface = new OffscreenCanvas(canvas.width, canvas.height);
      const source = surface.getContext("2d");
      const display = getContext.call(canvas, "2d", ...args);
      const raf = window.requestAnimationFrame;
      let dirty = false;
      window.requestAnimationFrame = handler => raf(time => {
        handler(time);
        if (!dirty) return;
        dirty = false;
        clearRect.call(display, 0, 0, canvas.width, canvas.height);
        display.drawImage(surface, 0, 0);
      });
      const methods = new Map();
      return new Proxy(source, {
        get(target, name) {
          if (name === "setTransform") return (...params) => {
            if (surface.width !== canvas.width) surface.width = canvas.width;
            if (surface.height !== canvas.height) surface.height = canvas.height;
            source.setTransform(...params);
          };
          if (name === "clearRect") return (...params) => {
            dirty = true;
            paint();
            source.clearRect(...params);
          };
          if (name === "fillText") return (...params) => {
            if (recording) data.drawnLabels++;
            source.fillText(...params);
          };
          if (typeof target[name] !== "function") return target[name];
          if (!methods.has(name)) methods.set(name, target[name].bind(target));
          return methods.get(name);
        },
        set(target, name, value) {
          target[name] = value;
          return true;
        }
      });
    };
  }
  window.addEventListener("wheel", event => {
    if (recording && event.target.id === "runtime-map") pending ??= event;
  }, { capture: true, passive: true });
  window.addEventListener("pointermove", event => {
    if (recording && event.buttons && event.target.id === "runtime-map") pending ??= event;
  }, { capture: true, passive: true });
}

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length ? +sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2) : null;
}

async function writeTrace(cdp, file) {
  const complete = new Promise(done => cdp.once("Tracing.tracingComplete", done));
  await cdp.send("Tracing.end");
  const { stream } = await complete;
  const chunks = [];
  let eof = false;
  while (!eof) {
    const part = await cdp.send("IO.read", { handle: stream });
    chunks.push(part.data);
    eof = part.eof;
  }
  await cdp.send("IO.close", { handle: stream });
  await writeFile(file, chunks.join(""));
}

async function run(acceleration, width, trial, preset) {
  const profile = await mkdtemp(resolve(tmpdir(), "codeorganism-edge-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "msedge", headless: false, viewport: null,
    args: ["--no-first-run", "--start-maximized", "--disable-backgrounding-occluded-windows",
      ...(acceleration ? [] : ["--disable-gpu", "--disable-gpu-compositing"])]
  });
  const key = `${acceleration ? "gpu" : "software"}-${width}-${trial}${preset ? `-${preset}` : ""}`;
  try {
    const page = context.pages()[0];
    const browser = context.browser();
    const root = await browser.newBrowserCDPSession();
    const cdp = await context.newCDPSession(page);
    await page.goto("edge://gpu");
    await page.getByText(/^Canvas:/).first().waitFor();
    const graphics = (await page.getByText(/^(Canvas|Compositing|Rasterization):/).locator("..").allInnerTexts()).join("\n");
    await writeFile(resolve(output, `${key}-gpu.txt`), graphics);
    if (process.env.MAP_PROFILE_GRAPHICS_ONLY === "1") return;
    const display = await page.evaluate(() => ({ dpr: devicePixelRatio, width: screen.width, height: screen.height }));
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: display.dpr, mobile: false
    });
    await page.addInitScript(instrument, offscreen);
    publish(false);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.bringToFront();
    if (preset) {
      await page.locator("#open-settings").click();
      await page.locator("#graphics-quality").selectOption(preset);
      await page.locator("#close-settings").click();
    }
    const allGroups = page.locator("#groups button");
    await allGroups.last().waitFor();
    for (const group of await allGroups.all()) await group.evaluate(button => button.click());
    const canvas = page.locator("#runtime-map");
    await canvas.scrollIntoViewIfNeeded();
    await delay(2500);
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const environment = await page.evaluate(() => ({
      dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
      canvas: [document.querySelector("canvas").clientWidth, document.querySelector("canvas").clientHeight],
      foreground: document.visibilityState === "visible" && document.hasFocus()
    }));
    if (!environment.foreground) throw new Error("The profile requires a focused, visible tab.");
    await root.send("Tracing.start", {
      categories: "devtools.timeline,blink.user_timing,input,latencyInfo,cc,gpu,viz,disabled-by-default-devtools.timeline.frame",
      transferMode: "ReturnAsStream"
    });
    const results = [];
    for (const phase of ["idle", "live", "wheel", "pan"]) {
      let updates;
      if (phase !== "idle") {
        publish(true);
        updates = setInterval(() => publish(true), 1000);
      }
      try {
        const start = await root.send("SystemInfo.getProcessInfo");
        const now = performance.now();
        await page.evaluate(phase => window.beginProfile(phase), phase);
        if (phase === "wheel" && beforeWheelChange) await page.keyboard.down("Control");
        if (phase === "pan" || phase === "wheel") await page.mouse.move(x, y);
        if (phase === "pan") await page.mouse.down();
        let step = 0;
        while (performance.now() - now < seconds * 1000) {
          if (phase === "wheel") await page.mouse.wheel(0, step % 2 ? 100 : -100);
          if (phase === "pan") await page.mouse.move(x + Math.sin(step / 3) * 70, y + Math.cos(step / 3) * 40);
          step++;
          await delay(phase === "pan" ? 20 : 125);
        }
        if (phase === "pan") await page.mouse.up();
        if (phase === "wheel" && beforeWheelChange) await page.keyboard.up("Control");
        const data = await page.evaluate(phase => window.endProfile(phase), phase);
        const elapsed = (performance.now() - now) / 1000;
        const end = await root.send("SystemInfo.getProcessInfo");
        const cpu = {};
        for (const process of end.processInfo) {
          const old = start.processInfo.find(previous => previous.id === process.id);
          if (old) cpu[process.type] = (cpu[process.type] ?? 0) + (process.cpuTime - old.cpuTime) * 100 / elapsed;
        }
        const interval = 1000 / refreshRate;
        results.push({
          phase, frames: data.frames.length, frameP50: percentile(data.frames, .5), frameP95: percentile(data.frames, .95),
          missed: data.frames.reduce((sum, ms) => sum + Math.max(0, Math.round(ms / interval) - 1), 0),
          longTasks: data.longTasks.length, longestTask: Math.max(0, ...data.longTasks),
          canvasDraws: data.canvasDraws, drawnLabels: data.drawnLabels,
          cpu, inputs: data.input.length, inputP95: percentile(data.input.map(input => input.ms), .95)
        });
      } finally {
        clearInterval(updates);
      }
    }
    await writeTrace(root, resolve(output, `${key}.trace.json`));
    if (process.env.MAP_PROFILE_CAPTURES === "1") {
      await page.locator("#reset-view").evaluate(button => button.click());
      publish(true);
      await delay(350);
      await page.screenshot({ path: resolve(output, `${key}.png`), fullPage: true });
    }
    const result = { key, preset, variant: offscreen ? "offscreen" : "direct", version: browser.version(),
      display, graphics, environment, results };
    await writeFile(resolve(output, `${key}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await context.close();
    if (dirname(profile) === resolve(tmpdir())) {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    }
  }
}

await mkdir(output, { recursive: true });
await new Promise(done => server.listen(0, "127.0.0.1", done));
try {
  const repeats = Number(process.env.MAP_PROFILE_REPEATS ?? 1);
  for (let trial = 1; trial <= repeats; trial++) {
    for (const acceleration of trial % 2 ? [true, false] : [false, true]) {
      if (process.env.MAP_PROFILE_SOFTWARE_ONLY === "1" && acceleration) continue;
      if (process.env.MAP_PROFILE_GPU_ONLY === "1" && !acceleration) continue;
      for (const preset of presets) {
        for (const width of [1440, 640]) await run(acceleration, width, trial, preset);
      }
    }
  }
} finally {
  server.closeAllConnections();
  server.close();
}
