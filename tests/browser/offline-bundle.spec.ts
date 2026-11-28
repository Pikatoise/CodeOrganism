import { expect } from "@playwright/test";
import { consoleDll, lineValue, test } from "./host-fixture";

test("published bundle serves local assets and attaches outside the repository", async ({ host, page }) => {
  test.skip(process.platform !== "win32" || process.env.CODEORGANISM_TEST_ETW !== "1" ||
    !process.env.CODEORGANISM_TEST_BUNDLE, "Set CODEORGANISM_TEST_BUNDLE and CODEORGANISM_TEST_ETW=1 to verify the Windows bundle.");
  const external: string[] = [];
  const assets = new Set<string>();
  await page.context().route("**/*", async route => {
    if (new URL(route.request().url()).origin === host.url) await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.ok() && path.startsWith("/assets/")) assets.add(path.split(".").pop()!);
  });

  const workload = host.start(consoleDll);
  const pid = await lineValue(workload, line => /"pid":(\d+)/.exec(line)?.[1]);
  await page.goto(host.url);
  await page.getByLabel("Process", { exact: true }).selectOption(pid);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(page.locator("#source-status")).toContainText("Live", { timeout: 15_000 });
  await page.locator("#groups").getByRole("button", { name: /Workload.Console/ }).click();
  await page.getByLabel("Ranking view").selectOption("methods");
  await expect(page.locator("#cpu-ranking button").first()).toContainText(/Busy(?:Alpha|Beta)/);
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect(page.locator("#source-status")).toHaveText("Detached", { timeout: 10_000 });
  expect(workload.exitCode).toBeNull();
  expect([...assets].sort()).toEqual(["css", "js"]);
  expect(external).toEqual([]);
});
