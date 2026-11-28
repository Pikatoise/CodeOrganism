import { expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { consoleDll, lineValue, paths, test } from "./host-fixture";

const nodes = [
  { id: "app", kind: "module", label: "Orders" },
  { id: "work", kind: "method", label: "PriceOrder", parentId: "app" },
  { id: "other", kind: "method", label: "BuildOrder", parentId: "app" },
  { id: "framework", kind: "module", label: "System.Runtime", library: "framework" },
  { id: "helper", kind: "method", label: "MoveNext", parentId: "framework" },
];
const links = [{ sourceId: "helper", targetId: "work", evidence: "stack-adjacency" }];

for (const width of [1440, 640]) {
  test(`groups, keyboard inspection, paused data and recovery at ${width}px`, async ({ page, host, request }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/view/v1/processes", async route => {
      await delay(250);
      await route.fulfill({ json: [{ pid: 42, name: "Orders demo", startedUtc: "2026-01-01T00:00:00Z" }] });
    });
    await page.goto(host.url);
    await expect(page.locator("#source-status")).toHaveText("No source connected");
    await expect(page.locator("#details")).toHaveJSProperty("open", false);
    const picker = page.getByLabel("Process", { exact: true });
    const refresh = page.getByRole("button", { name: "Refresh process list" });
    await expect(refresh).toHaveAttribute("title", "Refresh process list");
    await picker.selectOption("42");
    expect(await refresh.evaluate(button => button.nextElementSibling?.id)).toBe("process");
    await refresh.press("Enter");
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await expect(refresh).toBeEnabled();
    await expect(picker).toHaveValue("42");

    const headers = { Authorization: `Bearer ${host.credential}` };
    const registration = await request.post(host.url + paths.api, { headers, data: {
      requestId: "browser", version: 1, source: { id: "browser-fixture", label: "Orders demo" },
      capabilities: [{ metric: "cpu", unit: "ms", method: "windows-etw-on-cpu-sampling", quality: "estimated" }]
    } });
    expect(registration.status()).toBe(201);
    const { sessionId, limits } = await registration.json();
    let lastSent = 0;
    async function publish(sequence: number, alpha: number, beta: number, withLoss = false) {
      await delay(Math.max(0, limits.minIntervalMs + 25 - (Date.now() - lastSent)));
      const response = await request.post(`${host.url}${paths.api}/${sessionId}/batches`, { headers, data: {
        sequence, startMs: (sequence - 1) * 1_000, endMs: sequence * 1_000,
        nodes: sequence === 1 ? nodes : [], relationships: sequence === 1 ? links : [],
        measurements: [["work", alpha], ["other", beta], ["helper", 10]].map(([nodeId, value]) =>
          ({ nodeId, metric: "cpu", value, quality: "estimated", complete: true })),
        loss: withLoss ? [{ kind: "source-events", metric: "cpu", count: 3 }] : []
      } });
      expect(response.status()).toBe(202);
      lastSent = Date.now();
    }

    await publish(1, 800, 100);
    await expect(page.locator("#source-status")).toHaveText("Orders demo · Live");
    await expect(page.getByRole("heading", { name: "Top modules" })).toBeVisible();
    await expect(page.locator("#groups").getByRole("button", { name: /Libraries/ })).toBeVisible();
    await page.locator("#groups").getByRole("button", { name: /Libraries/ }).click();
    await expect(page.locator("#groups").getByRole("button", { name: /System.Runtime/ })).toBeVisible();
    await page.locator("#groups").getByRole("button", { name: /Orders/ }).press("Enter");
    await page.getByLabel("Ranking view").selectOption("methods");
    await expect(page.getByRole("heading", { name: "Top methods" })).toBeVisible();
    await page.getByRole("button", { name: /PriceOrder.*800 ms\/s/ }).press("Enter");
    await expect(page.locator("#details")).toHaveJSProperty("open", false);
    await page.locator("#details summary").press("Enter");
    await expect(page.locator("#selection-name")).toHaveText("Orders / PriceOrder");
    await expect(page.locator("#selection-values")).toContainText("800 ms/s · estimated");
    await expect(page.locator("#selection-values dt")).toHaveText(["CPU", "Interval"]);

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await publish(2, 40, 900, true);
    await expect(page.locator("#selection-values")).toContainText("800 ms/s");
    await expect(page.locator("#coverage")).not.toContainText("Measurement loss");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.locator("canvas").press("ArrowRight");
    await page.getByRole("button", { name: "Reset view" }).click();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator("#cpu-ranking").getByRole("button").first()).toContainText("BuildOrder");
    await expect(page.locator("#selection-values")).toContainText("(partial)");
    await expect(page.locator("#coverage")).toContainText("Measurement loss in this interval");
    await expect(page.locator("#source-status")).toContainText("Waiting for updates", { timeout: 5_000 });
    await publish(3, 850, 45);
    await expect(page.locator("#source-status")).toContainText("Live");
    await expect(page.locator("#selection-values")).toContainText("850 ms/s · estimated");
    await expect(page.locator("#selection-values")).not.toContainText("(partial)");
    await expect(page.locator('#cpu-ranking button[data-node="other"]')).toContainText("900 ms/s");
    const module = page.locator('#groups button[data-node="app"]');
    const method = page.locator('#groups > li > ul button[data-node="work"]');
    await expect(method).toBeVisible();
    await method.press("Enter");
    await expect(method).toHaveAttribute("aria-current", "true");
    await module.press("Enter");
    await expect(method).toBeHidden();
    await expect(module).toBeFocused();
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByRole("heading", { name: "Top methods" })).toBeVisible();
    await expect(page.locator('#cpu-ranking button[data-node="other"]')).toContainText("900 ms/s");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("canvas").evaluate(canvas => {
      const ctx = (canvas as HTMLCanvasElement).getContext("2d")!;
      return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data.some(value => value !== 0);
    })).toBe(true);
  });
}

test("rejects missing CSRF and explains exited, unsupported and restricted targets", async ({ page, host, request }) => {
  test.skip(process.platform !== "win32", "Windows process discovery");
  const native = host.start(process.env.ComSpec ?? "cmd.exe", {}, ["/d", "/q", "/k"]);
  const disabled = host.start(consoleDll, { DOTNET_EnableDiagnostics: "0" });
  expect(native.pid).toBeDefined();
  const disabledPid = Number(await lineValue(disabled, line => /"pid":(\d+)/.exec(line)?.[1]));
  await page.goto(host.url);
  const denied = await request.post(host.url + paths.view + "/attach", { data: { pid: disabledPid }, headers: { Origin: host.url } });
  expect(denied.status()).toBe(403);

  async function attempt(pid: number, state: string, explanation: string) {
    await page.getByLabel("Or enter PID").fill(String(pid));
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await expect(page.locator("#source-status")).toHaveText(state);
    await expect(page.locator("#control-message")).toContainText(explanation);
  }

  await attempt(2_000_000_000, "Process exited", "no longer running");
  await attempt(native.pid!, "Unsupported process", ".NET 10");
  await attempt(disabledPid, "Access restricted", "Enable .NET diagnostics");
});

test("attaches and detaches a live process through the browser", async ({ page, host }) => {
  test.skip(process.platform !== "win32" || process.env.CODEORGANISM_TEST_ETW !== "1",
    "Set CODEORGANISM_TEST_ETW=1 from an elevated Windows test shell.");
  const workload = host.start(consoleDll);
  const pid = await lineValue(workload, line => /"pid":(\d+)/.exec(line)?.[1]);
  await page.goto(host.url);
  await expect(page.locator("#process option").filter({ hasText: `PID ${pid}` })).toHaveCount(1);
  await page.getByLabel("Process", { exact: true }).selectOption(pid);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(page.locator("#source-status")).toContainText("Live", { timeout: 15_000 });
  await expect(page.locator("#groups").getByRole("button", { name: /Workload.Console/ })).toBeVisible();
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect(page.locator("#source-status")).toHaveText("Detached", { timeout: 10_000 });
  expect(workload.exitCode).toBeNull();

  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(page.locator("#source-status")).toContainText("Live", { timeout: 15_000 });
  workload.kill();
  await expect(page.locator("#source-status")).toHaveText("Process exited", { timeout: 10_000 });
});
