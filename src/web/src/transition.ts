export function transitionText(element: HTMLElement, value: string) {
  const previous = element.firstChild?.textContent ?? "";
  if (previous === value) return;
  element.replaceChildren(value);
  if (!previous || element.closest("details:not([open])") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const outgoing = document.createElement("span");
  outgoing.className = "outgoing-text";
  outgoing.setAttribute("aria-hidden", "true");
  outgoing.textContent = previous;
  element.append(outgoing);
  outgoing.addEventListener("animationend", () => outgoing.remove(), { once: true });
  outgoing.addEventListener("animationcancel", () => outgoing.remove(), { once: true });
}
