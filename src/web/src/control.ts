type ControlStatus = { state: string; reason?: string | null; pid?: number };
type Target = { pid: number; name: string; startedUtc: string };

export function connectControls(onStatus: (status: ControlStatus) => void) {
  const picker = document.querySelector<HTMLSelectElement>("#process")!;
  const pid = document.querySelector<HTMLInputElement>("#pid")!;
  const form = document.querySelector<HTMLFormElement>("#attach-form")!;
  const attach = document.querySelector<HTMLButtonElement>("#attach")!;
  const detach = document.querySelector<HTMLButtonElement>("#detach")!;
  const refresh = document.querySelector<HTMLButtonElement>("#refresh-processes")!;
  const message = document.querySelector<HTMLElement>("#control-message")!;
  let targets: Target[] = [];
  let csrf = "";
  let active = false;
  let external = false;
  let pending = false;
  let listing = false;
  let previousStatus = "";

  async function readControl() {
    try {
      const result = await fetch("/api/view/v1/control", { cache: "no-store" });
      if (!result.ok) throw new Error("Local process controls are unavailable.");
      const info = await result.json() as { csrf: string; status: ControlStatus };
      csrf = info.csrf;
      active = ["connecting", "connected", "detaching"].includes(info.status.state);
      onStatus(info.status);
      const signature = `${info.status.state}:${info.status.reason ?? ""}`;
      if (signature !== previousStatus) message.textContent = info.status.reason ?? "";
      previousStatus = signature;
      updateButtons();
    } catch {
      message.textContent = "Local process controls are unavailable.";
    }
  }

  async function discover() {
    if (listing) return;
    listing = true;
    updateButtons();
    try {
      if (!csrf) await readControl();
      const result = await fetch("/api/view/v1/processes", { cache: "no-store" });
      if (!result.ok) throw new Error("The process list is unavailable. You can still try a PID.");
      targets = await result.json() as Target[];
      const previous = picker.value;
      picker.replaceChildren(new Option(targets.length ? "Choose .NET 10 process" : "No supported processes found", ""),
        ...targets.map(target => new Option(`${target.name} (PID ${target.pid})`, String(target.pid))));
      if (targets.some(target => String(target.pid) === previous)) picker.value = previous;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not list processes.";
    } finally {
      listing = false;
      updateButtons();
    }
  }

  async function mutate(action: "attach" | "detach", body: object) {
    if (pending) return;
    pending = true;
    updateButtons();
    try {
      const result = await fetch(`/api/view/v1/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-CodeOrganism-CSRF": csrf },
        body: JSON.stringify(body)
      });
      if (!result.ok) {
        const failure = await result.json().catch(() => null) as { message?: string } | null;
        throw new Error(failure?.message || "The operation was rejected by the local host.");
      }
      await readControl();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Control request failed.";
    } finally {
      pending = false;
      updateButtons();
    }
  }

  function updateButtons() {
    attach.disabled = active || external || pending || !csrf || !(Number(picker.value) > 0 || Number(pid.value) > 0);
    detach.disabled = pending || !csrf || !(active || external);
    refresh.disabled = pending || listing;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const target = targets.find(item => item.pid === Number(picker.value));
    if (pid.value) void mutate("attach", { pid: Number(pid.value) });
    else if (target) void mutate("attach", { pid: target.pid, startedUtc: target.startedUtc });
  });
  detach.addEventListener("click", () => { void mutate("detach", {}); });
  refresh.addEventListener("click", () => { void discover(); });
  picker.addEventListener("change", () => { if (picker.value) pid.value = ""; updateButtons(); });
  pid.addEventListener("input", () => { if (pid.value) picker.value = ""; updateButtons(); });
  void discover();
  window.setInterval(() => { if (!pending) void readControl(); }, 1_000);

  return {
    externalLive(value: boolean) {
      external = value;
      updateButtons();
    }
  };
}
