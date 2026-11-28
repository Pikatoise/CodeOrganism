import type { Point } from "./graph/layout";
import { t } from "./language";

type Panel = {
  element: HTMLElement;
  position?: Point;
};

const gap = 10;
const directions: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }
};

export function connectFullscreenPanels(container: HTMLElement, inspector: HTMLElement, layer: HTMLElement,
  toggle: HTMLButtonElement, status: HTMLElement) {
  const parent = inspector.parentElement!;
  const panels: Panel[] = [...inspector.querySelectorAll<HTMLElement>(".inspection-panel")].map(element => ({ element }));
  const bodies = inspector.querySelectorAll<HTMLElement>(".panel-content");
  let active = false;
  let changing = false;
  let highest = 0;

  function localize() {
    const action = t(active ? "Exit fullscreen map" : "Open fullscreen map");
    toggle.setAttribute("aria-label", action);
    toggle.title = action;
    toggle.firstElementChild!.textContent = active ? "×" : "⛶";
    if (!status.hidden) status.textContent = t("Fullscreen is unavailable in this browser.");
  }

  async function change(enter: boolean) {
    if (changing) return;
    changing = true;
    status.hidden = true;
    try {
      if (enter) await container.requestFullscreen();
      else if (document.fullscreenElement === container) await document.exitFullscreen();
    } catch {
      status.textContent = t("Fullscreen is unavailable in this browser.");
      status.hidden = false;
    } finally {
      changing = false;
    }
  }

  toggle.addEventListener("click", () => { void change(document.fullscreenElement !== container); });
  document.addEventListener("fullscreenchange", () => {
    const next = document.fullscreenElement === container;
    if (active === next) return;
    active = next;
    if (active) {
      layer.hidden = false;
      layer.append(inspector);
      for (const body of bodies) body.tabIndex = 0;
      layout();
    } else {
      parent.append(inspector);
      layer.hidden = true;
      for (const body of bodies) body.removeAttribute("tabindex");
    }
    localize();
    toggle.focus({ preventScroll: true });
  });
  container.addEventListener("keydown", event => {
    if (active && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      void change(false);
    }
  });

  const resize = new ResizeObserver(layout);
  resize.observe(layer);
  for (const panel of panels) {
    const handle = panel.element.querySelector<HTMLButtonElement>(".panel-move")!;
    let drag: { pointer: number; origin: Point; position: Point } | undefined;
    function raise() { panel.element.style.zIndex = String(++highest); }
    panel.element.addEventListener("focusin", () => { if (active) raise(); });
    panel.element.addEventListener("pointerdown", () => { if (active) raise(); });
    handle.addEventListener("pointerdown", event => {
      if (!active || event.button !== 0 || !event.isPrimary || !panel.position) return;
      drag = { pointer: event.pointerId, origin: { x: event.clientX, y: event.clientY }, position: panel.position };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!active || drag?.pointer !== event.pointerId) return;
      place(panel, {
        x: drag.position.x + event.clientX - drag.origin.x,
        y: drag.position.y + event.clientY - drag.origin.y
      });
    });
    handle.addEventListener("lostpointercapture", () => { drag = undefined; });
    handle.addEventListener("keydown", event => {
      const direction = directions[event.key];
      if (!active || !direction || !panel.position) return;
      event.preventDefault();
      const distance = event.shiftKey ? 64 : 16;
      place(panel, { x: panel.position.x + direction.x * distance, y: panel.position.y + direction.y * distance });
    });
    resize.observe(panel.element);
  }

  function layout() {
    if (!active || !layer.clientWidth || !layer.clientHeight) return;
    const width = panels[0].element.offsetWidth;
    const height = Math.max(...panels.map(panel => panel.element.offsetHeight));
    const columns = Math.max(1, Math.min(panels.length, Math.floor((layer.clientWidth + gap) / (width + gap))));
    const rows = Math.ceil(panels.length / columns);
    const rowHeight = rows > 1 ? Math.min(height + gap, Math.max(0, (layer.clientHeight - height) / (rows - 1))) : 0;
    for (const [index, panel] of panels.entries()) {
      place(panel, panel.position ?? {
        x: index % columns * (width + gap),
        y: Math.floor(index / columns) * rowHeight
      });
    }
  }

  function place(panel: Panel, point: Point) {
    const x = Math.max(0, Math.min(point.x, layer.clientWidth - panel.element.offsetWidth));
    const y = Math.max(0, Math.min(point.y, layer.clientHeight - panel.element.offsetHeight));
    panel.position = { x, y };
    panel.element.style.setProperty("--panel-x", `${x}px`);
    panel.element.style.setProperty("--panel-y", `${y}px`);
  }

  return { localize };
}
