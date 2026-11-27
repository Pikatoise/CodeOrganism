import { test as base } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(__dirname, "../..");
const dotnet = process.env.CODEORGANISM_TEST_DOTNET || "dotnet";
const hostDll = "src/CodeOrganism.Host/bin/Release/net10.0/CodeOrganism.Host.dll";
export const consoleDll = "samples/Workload.Console/bin/Release/net10.0/Workload.Console.dll";
export const paths = { api: "/api/connector/v1/sessions", view: "/api/view/v1" };
type Host = { url: string; credential: string; start: (binary: string, env?: NodeJS.ProcessEnv, args?: string[]) => ChildProcess };

export const test = base.extend<{ host: Host }>({
  host: async ({}, use) => {
    const children: ChildProcess[] = [];
    function start(binary: string, env: NodeJS.ProcessEnv = {}, args: string[] = [], cwd = root) {
      const child = spawn(binary.endsWith(".dll") ? dotnet : binary,
        binary.endsWith(".dll") ? [binary, ...args] : args, {
          cwd, env: { ...process.env, ...env }, stdio: "pipe", windowsHide: true
        });
      children.push(child);
      child.stderr?.resume();
      return child;
    }

    const credential = randomBytes(24).toString("hex");
    const bundle = process.env.CODEORGANISM_TEST_BUNDLE;
    const host = start(bundle ? resolve(bundle, "CodeOrganism.Host.exe") : hostDll,
      { CODEORGANISM_PRODUCER_TOKEN: credential }, [], bundle ? tmpdir() : root);
    try {
      const url = await lineValue(host, line => /http:\/\/127\.0\.0\.1:\d+/.exec(line)?.[0]);
      await use({ url, credential, start });
    } finally {
      for (const child of children.reverse()) {
        if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) continue;
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
  }
});

export async function lineValue(child: ChildProcess, match: (line: string) => string | undefined) {
  if (!child.stdout) throw new Error("The child output is unavailable.");
  return new Promise<string>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    const timer = setTimeout(() => finish(new Error("The child did not become ready.")), 10_000);
    const died = () => finish(new Error("The child stopped before reporting readiness."));
    const finish = (error?: Error, value?: string) => {
      clearTimeout(timer);
      child.off("exit", died);
      lines.close();
      child.stdout?.resume();
      if (error) reject(error);
      else resolve(value!);
    };
    child.once("exit", died);
    lines.on("line", line => {
      const value = match(line);
      if (value) finish(undefined, value);
    });
  });
}
