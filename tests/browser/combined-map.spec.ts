import { expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { lineValue, paths, test } from "./host-fixture";

for (const width of [1440, 640]) {
  test(`combined channels, ranking and partial calls at ${width}px`, async ({ page, host, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const prototype = CanvasRenderingContext2D.prototype;
      const gradient = prototype.createRadialGradient;
      const marker = window as Window & { callGlowRadius?: number };
      prototype.createRadialGradient = function (...args) {
        marker.callGlowRadius = args[5] - args[2];
        return gradient.apply(this, args);
      };
    });
    await page.goto(host.url);
    const headers = { Authorization: `Bearer ${host.credential}` };
    const created = await request.post(host.url + paths.api, { headers, data: {
      requestId: "combined", version: 1, source: { id: "fixture", label: "Combined fixture" },
      capabilities: [
        { metric: "cpu", unit: "ms", method: "windows-etw-on-cpu-sampling", quality: "estimated" },
        { metric: "allocation", unit: "byte", method: "dotnet-eventpipe-allocation-ticks", quality: "estimated" },
        { metric: "calls", unit: "count", method: "dotnet-eventpipe-entry-checkpoints", quality: "exact" }
      ]
    } });
    expect(created.status()).toBe(201);
    const { sessionId, limits } = await created.json();
    const nodes = [
      { id: "module", label: "Workloads", kind: "module" },
      ...["Compute", "Allocate", "Dispatch"].map(label => ({ id: label, label, kind: "method", parentId: "module" }))
    ];
    async function publish(sequence: number, complete: boolean) {
      const response = await request.post(`${host.url}${paths.api}/${sessionId}/batches`, { headers, data: {
        sequence, startMs: (sequence - 1) * 1000, endMs: sequence * 1000,
        nodes: sequence === 1 ? nodes : [], relationships: [],
        measurements: [
          { nodeId: "Compute", metric: "cpu", value: 800, quality: "estimated", complete: true },
          { nodeId: "Allocate", metric: "allocation", value: 32 * 1024 ** 2, quality: "estimated", complete: true },
          { nodeId: "Dispatch", metric: "cpu", value: 25, quality: "estimated", complete: true },
          { nodeId: "Dispatch", metric: "allocation", value: 1024 ** 2, quality: "estimated", complete: true },
          { nodeId: "Dispatch", metric: "calls", value: complete ? 8000 : 17, quality: "exact", complete }
        ], loss: complete ? [] : [{ kind: "source-events", metric: "calls" }]
      } });
      expect(response.status()).toBe(202);
    }

    await publish(1, true);
    await page.getByRole("button", { name: "Combined", exact: true }).click();
    await page.locator("#groups").getByRole("button", { name: /Workloads/ }).click();
    const rank = page.locator("#cpu-ranking button").first();
    await expect(rank).toContainText("Compute");
    await page.getByLabel("Rank by").selectOption("allocation");
    await expect(rank).toContainText("Allocate");
    await page.getByLabel("Rank by").selectOption("calls");
    await expect(rank).toContainText("Dispatch");
    await rank.click();
    const readings = page.locator("#selection-values");
    for (const value of ["25 ms/s", "1 MiB/s", "8,000 calls/s", "Exact", "Complete checkpoint window"])
      await expect(readings).toContainText(value);
    for (const channel of ["Pulse:", "Size:", "Glow:"])
      await expect(page.locator("#metric-legend")).toContainText(channel);
    await expect.poll(() => page.evaluate(() => (window as Window & { callGlowRadius?: number }).callGlowRadius ?? 0))
      .toBeGreaterThan(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await delay(limits.minIntervalMs + 25);
    await publish(2, false);
    await expect(readings).toContainText("17 covered calls");
    await expect(readings).toContainText("Partial checkpoint window");
    await expect(readings).toContainText("Covered entries only");
    await expect(readings).not.toContainText("Exact");
    await page.getByRole("button", { name: "Calls", exact: true }).click();
    await expect(page.getByLabel("Rank by")).toBeHidden();
    await expect(readings).not.toContainText("MiB/s");
  });
}

test("prepared target exposes calls through the first-party connector", async ({ page, host }) => {
  const prepared = process.env.CODEORGANISM_TEST_CALL_TARGET;
  test.skip(process.platform !== "win32" || process.env.CODEORGANISM_TEST_ETW !== "1" || !prepared,
    "Set CODEORGANISM_TEST_ETW=1 and CODEORGANISM_TEST_CALL_TARGET from an elevated Windows test shell.");
  const workload = host.start(prepared!, {}, ["--calls"]);
  const pid = await lineValue(workload, line => /"pid":(\d+)/.exec(line)?.[1]);
  workload.stdin!.write("1000\n");
  await lineValue(workload, line => line.includes("elapsedMs") ? line : undefined);
  await page.goto(host.url);
  await page.getByLabel("Process", { exact: true }).selectOption(pid);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page.getByRole("button", { name: "Calls", exact: true }).click({ timeout: 12_000 });
  await expect(page.locator("#cpu-ranking button").first()).toContainText("0 calls/s");
  await page.getByRole("button", { name: "Combined", exact: true }).click();
  await expect(page.getByLabel("Rank by")).toHaveValue("calls");
  await page.locator("#groups").getByRole("button", { name: /Workload.Console/ }).first().click();
  const rank = page.locator("#cpu-ranking button").first();
  await expect(rank).toContainText("0 calls/s");
  const feed = setInterval(() => workload.stdin!.write("50000\n"), 125);
  try {
    await expect(rank).toContainText(/RecursiveEntry\s*[1-9][\d,]*(?:\.\d+)? calls\/s/, { timeout: 8_000 });
  } finally {
    clearInterval(feed);
  }
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect(page.locator("#source-status")).toHaveText("Detached", { timeout: 10_000 });
  expect(workload.exitCode).toBeNull();
});
