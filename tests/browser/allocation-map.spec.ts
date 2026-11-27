import { expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { consoleDll, lineValue, paths, test } from "./host-fixture";

test("allocation size and units distinguish zero from missing samples", async ({ page, host, request }) => {
  await page.addInitScript(() => {
    const context = CanvasRenderingContext2D.prototype;
    const clear = context.clearRect;
    const arc = context.arc;
    const marker = window as Window & { drawnRadius: number };
    context.clearRect = function (...args) {
      marker.drawnRadius = 0;
      return clear.apply(this, args);
    };
    context.arc = function (...args) {
      marker.drawnRadius = Math.max(marker.drawnRadius, args[2]);
      return arc.apply(this, args);
    };
  });
  await page.goto(host.url);
  const headers = { Authorization: `Bearer ${host.credential}` };
  const created = await request.post(host.url + paths.api, { headers, data: {
    requestId: "memory-test", version: 1, source: { id: "allocation-test", label: "Orders demo" },
    capabilities: [
      { metric: "cpu", unit: "ms", method: "windows-etw-on-cpu-sampling", quality: "estimated" },
      { metric: "allocation", unit: "byte", method: "dotnet-eventpipe-allocation-ticks", quality: "estimated" }
    ]
  } });
  expect(created.status()).toBe(201);
  const { sessionId, limits } = await created.json();
  const nodes = [
    { id: "orders", kind: "module", label: "Orders" },
    { id: "price", kind: "method", parentId: "orders", label: "PriceOrder" },
    { id: "bill", kind: "method", parentId: "orders", label: "CreateInvoice" }
  ];
  let lastSent = 0;
  async function publish(sequence: number, bytes: number | null, other = 0, unresolved = false) {
    await delay(Math.max(0, limits.minIntervalMs + 25 - (Date.now() - lastSent)));
    const measures = [{ nodeId: "bill", metric: "allocation", value: other, quality: "estimated", complete: true }];
    if (bytes !== null) measures.push({ nodeId: "price", metric: "allocation", value: bytes, quality: "estimated", complete: true });
    const response = await request.post(`${host.url}${paths.api}/${sessionId}/batches`, { headers, data: {
      sequence, startMs: (sequence - 1) * 1_000, endMs: sequence * 1_000,
      nodes: sequence === 1 ? nodes : [], relationships: [], measurements: measures,
      loss: unresolved ? [{ kind: "unresolved-attribution", metric: "allocation" }] : []
    } });
    expect(response.status()).toBe(202);
    lastSent = Date.now();
  }

  await publish(1, 0);
  await page.getByRole("button", { name: "Allocations", exact: true }).click();
  await page.locator("#groups").getByRole("button", { name: /Orders/ }).click();
  await page.getByRole("button", { name: /PriceOrder.*0 B\/s/ }).click();
  const values = page.locator("#selection-values");
  await expect(values).toContainText("0 B/s");
  await expect(values).toContainText("Estimated");
  await expect(values).toContainText(".NET EventPipe allocation ticks");
  await expect(page.locator("#metric-legend")).toHaveText("Size: allocation rate");
  const maxRadius = () => page.evaluate(() => (window as Window & { drawnRadius: number }).drawnRadius);
  await expect.poll(maxRadius).toBeGreaterThan(0);
  const atZero = await maxRadius();

  await publish(2, 32 * 1024 ** 2, 1024);
  await expect(page.locator("#cpu-ranking button").first()).toContainText("PriceOrder");
  await expect(values).toContainText("32 MiB/s");
  await expect.poll(maxRadius).toBeGreaterThan(atZero + 3);

  await publish(3, null, 4 * 1024 ** 2, true);
  await expect(page.locator("#cpu-ranking button").first()).toContainText("CreateInvoice");
  await expect(values).toContainText("Unavailable");
  await expect(values).not.toContainText("0 B/s");
  await expect(page.locator("#coverage")).toContainText("Some allocation samples could not be attributed.");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await expect(page.locator("#coverage")).not.toContainText("Some allocation samples could not be attributed.");
});

test("allocation ranking follows the real EventPipe workload", async ({ page, host }) => {
  test.skip(process.platform !== "win32" || process.env.CODEORGANISM_TEST_ETW !== "1",
    "Set CODEORGANISM_TEST_ETW=1 from an elevated Windows test shell.");
  const workload = host.start(consoleDll, {}, ["--allocations"]);
  const pid = await lineValue(workload, line => /"pid":(\d+)/.exec(line)?.[1]);
  await page.goto(host.url);
  await expect(page.locator("#process option").filter({ hasText: `PID ${pid}` })).toHaveCount(1);
  await page.getByLabel("Process", { exact: true }).selectOption(pid);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page.getByRole("button", { name: "Allocations", exact: true }).click({ timeout: 15_000 });
  await page.locator("#groups").getByRole("button", { name: /Workload.Console/ }).click({ timeout: 12_000 });
  const leading = page.locator("#cpu-ranking button").first();
  await expect(leading).toContainText("AllocateOrders", { timeout: 12_000 });
  await expect(leading).toContainText("AllocateInvoices", { timeout: 12_000 });
  await expect(page.locator("#rank-metric")).toContainText("estimated");
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect(page.locator("#source-status")).toHaveText("Detached", { timeout: 10_000 });
  expect(workload.exitCode).toBeNull();
});
