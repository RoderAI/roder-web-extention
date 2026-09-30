import { ensureRef, resolveRef } from "./refs";
type Target = { ref?: string; selector?: string; text?: string };
function visible(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    box.width > 0 &&
    box.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}
export function resolveTarget(opts: Target): HTMLElement {
  let candidates: HTMLElement[];
  if (opts.ref)
    candidates = [resolveRef(opts.ref)].filter((e): e is HTMLElement => !!e);
  else if (opts.selector)
    candidates = Array.from(
      document.querySelectorAll<HTMLElement>(opts.selector),
    );
  else if (opts.text?.trim()) {
    const text = opts.text.trim().toLowerCase();
    candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a,button,input,textarea,select,[role="button"],[role="link"]',
      ),
    ).filter((e) =>
      `${e.innerText} ${e.getAttribute("aria-label") ?? ""} ${(e as HTMLInputElement).placeholder ?? ""}`
        .toLowerCase()
        .includes(text),
    );
  } else throw new Error("An element target is required");
  candidates = candidates.filter(visible);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "Ambiguous element target"
        : "No matching visible element",
    );
  return candidates[0];
}
export function probe(
  opts: Target & { editing?: boolean },
): Record<string, unknown> {
  const target = resolveTarget(opts);
  if (
    target.matches(":disabled") ||
    target.getAttribute("aria-disabled") === "true"
  )
    throw new Error("Target is disabled");
  if (opts.editing) {
    const editable =
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        [
          "text",
          "search",
          "email",
          "url",
          "tel",
          "password",
          "number",
        ].includes(target.type)) ||
      target.isContentEditable;
    if (!editable || ("readOnly" in target && target.readOnly))
      throw new Error("Target is not editable");
  }
  target.scrollIntoView({
    behavior: "instant",
    block: "center",
    inline: "center",
  });
  const box = target.getBoundingClientRect();
  const x =
    Math.max(0, box.left) +
    (Math.min(innerWidth, box.right) - Math.max(0, box.left)) / 2;
  const y =
    Math.max(0, box.top) +
    (Math.min(innerHeight, box.bottom) - Math.max(0, box.top)) / 2;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !(target === hit || target.contains(hit)))
    throw new Error("Target is covered or outside the viewport");
  return { ref: ensureRef(target), x, y };
}
export function focused(ref: string): Record<string, unknown> {
  const target = resolveRef(ref);
  return {
    focused:
      !!target &&
      (document.activeElement === target ||
        target.contains(document.activeElement)),
    value: target instanceof HTMLSelectElement ? target.value : undefined,
  };
}
export function highlight(opts: Target): Record<string, unknown> {
  const target = resolveTarget(opts);
  const previous = target.style.outline;
  target.style.outline = "3px solid #1a73e8";
  setTimeout(() => {
    target.style.outline = previous;
  }, 1800);
  return { ref: ensureRef(target) };
}

// A semantic DOM selection is distinct from a native keyboard gesture. Chromium
// does not route tab-targeted CDP keys through macOS native select popups.
export function selectOption(opts: {
  selector: string;
  value: string;
}): Record<string, unknown> {
  const target = resolveTarget(opts);
  if (!(target instanceof HTMLSelectElement) || target.disabled)
    throw new Error("Target is not an enabled select");
  const option = Array.from(target.options).find(
    (o) =>
      o.value === opts.value &&
      !o.disabled &&
      !(
        o.parentElement instanceof HTMLOptGroupElement &&
        o.parentElement.disabled
      ),
  );
  if (!option) throw new Error("No enabled option has that value");
  target.value = opts.value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  if (target.value !== opts.value)
    throw new Error("Page rejected the requested selection");
  return { value: target.value, method: "DOM selection", eventsTrusted: false };
}
