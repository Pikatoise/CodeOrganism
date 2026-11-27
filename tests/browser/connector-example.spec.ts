import { expect } from "@playwright/test";
import { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { paths, test } from "./host-fixture";

test("stand-alone publisher exposes calls and reports contract conflicts", async ({ host, page, request }) => {
  test.skip(process.platform !== "win32", "Requires Windows PowerShell for the standalone example.");
  await page.goto(host.url);
  const startSample = (intervals: number, version = 1, credential = host.credential) => host.start(
    "powershell.exe", { CODEORGANISM_PRODUCER_TOKEN: credential },
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "samples/Connector.Example/publish.ps1",
      "-Origin", host.url, "-Intervals", String(intervals), "-Version", String(version)]);
  const unauthorized = await exitReport(startSample(1, 1, "invalid-token"));
  expect(unauthorized).toMatchObject({ code: 1, error: expect.stringContaining("HTTP 401, invalid-credential") });

  const publisher = exitReport(startSample(8));
  await expect(page.locator("#source-status")).toHaveText("PowerShell example · Live");
  await expect(page.getByRole("button", { name: "CPU", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Allocations", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Combined", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Calls", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#groups").getByRole("button", { name: /Example script/ }).click();
  await page.locator("#cpu-ranking").getByRole("button", { name: /Invoke-ExampleWork.*calls\/s/ }).click();
  await expect(page.locator("#selection-values")).toContainText("Exact");
  await expect(page.locator("#selection-values")).toContainText("Complete checkpoint window");

  const response = await request.post(host.url + paths.view + "/detach", { headers: {
    Authorization: `Bearer ${host.credential}`, Origin: host.url
  } });
  expect(response.status()).toBe(403);

  const [incompatible, occupied] = await Promise.all([
    exitReport(startSample(1, 2)), exitReport(startSample(1))
  ]);
  expect(incompatible).toMatchObject({ code: 1, error: expect.stringContaining("HTTP 409, unsupported-version") });
  expect(occupied).toMatchObject({ code: 1, error: expect.stringContaining("HTTP 409, session-in-use") });
  expect(await publisher).toMatchObject({ code: 0, output: expect.stringContaining("Published 120 calls") });
  await expect(page.locator("#source-status")).toHaveText("Disconnected");
});

async function exitReport(process: ChildProcess) {
  let output = "", error = "";
  process.stdout?.on("data", chunk => { output += chunk; });
  process.stderr?.on("data", chunk => { error += chunk; });
  const [code] = await once(process, "close");
  return { code, output, error };
}
