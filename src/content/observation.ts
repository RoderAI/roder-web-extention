import { isSensitiveField } from "../shared/redaction";
let masks: HTMLElement[] = [];
export function maskSecrets(on: boolean): void {
  masks.forEach((mask) => mask.remove());
  masks = [];
  if (!on) return;
  for (const input of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >("input,textarea")) {
    if (
      !input.value ||
      !isSensitiveField({
        type: input.type,
        name: input.name,
        id: input.id,
        autocomplete: input.autocomplete,
      })
    )
      continue;
    const box = input.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const mask = document.createElement("div");
    mask.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;background:#000!important;opacity:1!important;z-index:2147483647;pointer-events:none;`;
    document.documentElement.append(mask);
    masks.push(mask);
  }
}
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const finish = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve();
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, 250);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const cap = setTimeout(finish, 2000);
    quiet = setTimeout(finish, 250);
  });
}
