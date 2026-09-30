// References live in the extension's isolated world, never in page attributes.
export const documentToken = Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");
const refs = new WeakMap<Element, string>();
const elements = new Map<string, Element>();
export function ensureRef(element: Element): string {
  let ref = refs.get(element);
  if (!ref) {
    ref = `r${documentToken}-${elements.size + 1}`;
    refs.set(element, ref);
    elements.set(ref, element);
  }
  return ref;
}
export function resolveRef(ref: string): HTMLElement | undefined {
  const element = elements.get(ref);
  return element instanceof HTMLElement && element.isConnected
    ? element
    : undefined;
}
