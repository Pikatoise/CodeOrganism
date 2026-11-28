import { expect } from "@playwright/test";
import { resolve } from "node:path";
import { lineValue, paths, test } from "./host-fixture";

test.use({ viewport: { width: 640, height: 900 }, deviceScaleFactor: 3, reducedMotion: "reduce" });

test("settings translate the live view, update the canvas and survive a new loopback port", async ({ page, host, request }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...args: [Path2D?]) {
      if (this.canvas.id === "runtime-map" && Math.abs(this.lineWidth - .85) < .001) {
        this.canvas.dataset.stroke = String(this.strokeStyle);
      }
      if (this.canvas.id === "runtime-map" && this.strokeStyle === "#ac64ed") {
        const width = Number(this.canvas.dataset.haloWidth);
        this.canvas.dataset.haloWidth = String(Number.isNaN(width) ? this.lineWidth : Math.max(width, this.lineWidth));
      }
      return args[0] ? original.call(this, args[0]) : original.call(this);
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      delete this.canvas.dataset.haloWidth;
      return clear.apply(this, args);
    };
  });
  await page.goto(host.url);
  const root = page.locator("html");
  const canvas = page.locator("#runtime-map");
  const scale = () => canvas.evaluate(element => (element as HTMLCanvasElement).width / element.clientWidth);
  const background = () => page.locator(".workspace").evaluate(element => getComputedStyle(element).backgroundColor);
  await expect(root).toHaveAttribute("data-theme", "purple");
  await expect.poll(scale).toBe(2);
  const purple = await background();

  const headers = { Authorization: `Bearer ${host.credential}` };
  const registration = await request.post(host.url + paths.api, { headers, data: {
    requestId: "settings", version: 1, source: { id: "settings", label: "Orders Demo" },
    capabilities: [{ metric: "cpu", unit: "ms", method: "windows-etw-on-cpu-sampling", quality: "estimated" }]
  } });
  expect(registration.status()).toBe(201);
  const { sessionId } = await registration.json();
  const batch = await request.post(`${host.url}${paths.api}/${sessionId}/batches`, { headers, data: {
    sequence: 1, startMs: 0, endMs: 1000,
    nodes: [
      { id: "orders", kind: "module", label: "Orders" },
      { id: "work", kind: "method", label: "Calculate", parentId: "orders" }
    ],
    relationships: [{ sourceId: "orders", targetId: "orders", evidence: "stack-adjacency" }],
    measurements: [{ nodeId: "work", metric: "cpu", value: 800.5, quality: "estimated", complete: true }],
    loss: []
  } });
  expect(batch.status()).toBe(202);
  await expect(canvas).toHaveAttribute("data-stroke", "#9473b0");
  await page.locator("#groups button").first().click();
  await page.getByLabel("Ranking view").selectOption("methods");
  await page.locator("#cpu-ranking button").first().click();
  await expect(page.locator("#details")).toHaveJSProperty("open", false);
  await page.locator("#details summary").press("Enter");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-halo-width", "8");
  const open = page.locator("#open-settings");
  await open.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Settings");
  await expect(page.locator("#graphics-quality")).toBeFocused();
  await page.getByLabel("Graphics quality").selectOption("high");
  await expect.poll(scale).toBe(3);
  await expect(canvas).toHaveAttribute("data-halo-width", "22");
  await page.getByLabel("Graphics quality").selectOption("low");
  await expect.poll(scale).toBe(1);
  await expect(canvas).toHaveAttribute("data-halo-width", "3");
  await page.getByLabel("Theme").selectOption("dark");
  await expect(canvas).toHaveAttribute("data-stroke", "#74849d");
  const dark = await background();
  await page.getByLabel("Theme").selectOption("light");
  await expect(canvas).toHaveAttribute("data-stroke", "#79698d");
  expect(new Set([purple, dark, await background()]).size).toBe(3);
  await page.getByLabel("Language").selectOption("ru");
  await expect(dialog).toHaveAccessibleName("Настройки");
  await expect(root).toHaveAttribute("lang", "ru");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.getByRole("button", { name: "Обновить список процессов" }))
    .toHaveAttribute("title", "Обновить список процессов");
  await expect(page.getByLabel("Масштаб в процентах")).toHaveValue("100%");
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();
  await expect(page.locator("#source-status")).toContainText("Orders Demo");
  await expect(page.locator("#ranking-title")).toHaveText("Топ методов");
  await expect(page.locator("#selection-name")).toHaveText("Orders / Calculate");
  await expect(page.locator("#selection-values")).toContainText("800,5 мс/с");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);

  const bundle = process.env.CODEORGANISM_TEST_BUNDLE;
  const next = host.start(bundle ? resolve(bundle, "CodeOrganism.Host.exe") :
    "src/CodeOrganism.Host/bin/Release/net10.0/CodeOrganism.Host.dll");
  const url = await lineValue(next, line => /http:\/\/127\.0\.0\.1:\d+/.exec(line)?.[0]);
  expect(url).not.toBe(host.url);
  await page.goto(url);
  await expect(root).toHaveAttribute("lang", "ru");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect.poll(scale).toBe(1);
  await open.click();
  await page.getByLabel("Язык").selectOption("en");
  await expect(dialog).toHaveAccessibleName("Settings");
});
