/// <reference types="chrome" />

// =============================================================================
// Enriched page snapshot: aria roles/names, form metadata, bounding boxes,
// viewport info, iframe boundaries, and stable element refs.
//
// Stable refs: each captured element is assigned a `data-roder-ref` attribute
// (when it does not already have one) so a ref returned in a snapshot can be
// re-resolved later for click/type/etc even if the DOM shifts.
// =============================================================================

import type {
  BoundingBox,
  FormField,
  FormMeta,
  IframeBoundary,
  PageControl,
  PageSnapshot,
  SnapshotInclude,
  ViewportInfo,
} from '../shared/protocol';
import { safeFieldValue } from '../shared/redaction';

export const REF_ATTR = 'data-roder-ref';
let refCounter = 0;

const CONTROL_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [contenteditable="true"]';

function cssEscape(value: string): string {
  // Prefer the native CSS.escape when present.
  const cssApi = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (cssApi?.escape) return cssApi.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function selectorFor(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const currentTag = current.tagName;
    const siblings = Array.from(parent.children).filter(
      (child): child is Element => child instanceof Element && child.tagName === currentTag,
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    current = parent;
  }
  return parts.join(' > ');
}

/** Assign (or reuse) a stable ref attribute on an element. */
export function ensureRef(element: Element): string {
  const existing = element.getAttribute(REF_ATTR);
  if (existing) return existing;
  refCounter += 1;
  const ref = `r${refCounter}`;
  element.setAttribute(REF_ATTR, ref);
  return ref;
}

function visibleText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function boxOf(element: Element): BoundingBox {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** Compute the accessible name following a simplified aria algorithm. */
function accessibleName(element: HTMLElement): string | undefined {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (names.length) return names.join(' ');
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (element.labels && element.labels.length) {
      const text = Array.from(element.labels)
        .map((l) => l.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }
    if (element instanceof HTMLInputElement && element.placeholder) return element.placeholder;
  }

  const title = element.getAttribute('title');
  if (title) return title.trim();

  return undefined;
}

function implicitRole(element: HTMLElement): string | undefined {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return (element as HTMLAnchorElement).href ? 'link' : undefined;
    case 'button':
      return 'button';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'input': {
      const type = (element as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    default:
      return undefined;
  }
}

function collectControls(includeBoxes: boolean): PageControl[] {
  const nodes = document.querySelectorAll(CONTROL_SELECTOR);
  return Array.from(nodes)
    .filter(isVisible)
    .slice(0, 160)
    .map((node) => {
      const element = node as HTMLElement;
      const input = element as HTMLInputElement;
      const type = element instanceof HTMLInputElement ? element.type : undefined;
      const value = safeFieldValue(
        'value' in input ? input.value : undefined,
        { type, name: input.name, id: element.id, autocomplete: element.getAttribute('autocomplete') },
        80,
      );
      const control: PageControl = {
        ref: ensureRef(element),
        tag: element.tagName.toLowerCase(),
        text: visibleText(element) || value || input.placeholder?.slice(0, 80) || '',
        role: implicitRole(element),
        ariaLabel: element.getAttribute('aria-label') ?? undefined,
        ariaName: accessibleName(element),
        name: input.name || undefined,
        id: element.id || undefined,
        type,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        value,
        placeholder: input.placeholder || undefined,
        disabled: 'disabled' in input ? Boolean(input.disabled) : undefined,
        checked: element instanceof HTMLInputElement && (type === 'checkbox' || type === 'radio') ? element.checked : undefined,
        selector: selectorFor(element),
      };
      if (includeBoxes) control.box = boxOf(element);
      return control;
    });
}

function collectForms(): FormMeta[] {
  return Array.from(document.forms)
    .slice(0, 40)
    .map((form) => {
      const fields: FormField[] = Array.from(form.elements)
        .filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName !== 'BUTTON')
        .slice(0, 60)
        .map((el) => {
          const input = el as HTMLInputElement;
          return {
            ref: ensureRef(el),
            name: input.name || undefined,
            type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
            required: 'required' in input ? Boolean(input.required) : undefined,
            label: accessibleName(el),
          } satisfies FormField;
        });
      return {
        ref: ensureRef(form),
        name: form.getAttribute('name') ?? undefined,
        id: form.id || undefined,
        action: form.getAttribute('action') ?? undefined,
        method: form.getAttribute('method') ?? undefined,
        fields,
      } satisfies FormMeta;
    });
}

function collectIframes(includeBoxes: boolean): IframeBoundary[] {
  return Array.from(document.querySelectorAll('iframe'))
    .slice(0, 30)
    .map((frame, index) => {
      let crossOrigin = false;
      try {
        // Touching contentDocument throws for cross-origin frames.
        crossOrigin = frame.contentDocument === null;
      } catch {
        crossOrigin = true;
      }
      const boundary: IframeBoundary = {
        index,
        src: frame.getAttribute('src') ?? undefined,
        crossOrigin,
      };
      if (includeBoxes) boundary.box = boxOf(frame);
      return boundary;
    });
}

function viewportInfo(): ViewportInfo {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
    devicePixelRatio: window.devicePixelRatio,
  };
}

/** Capture an enriched snapshot. `include` defaults to everything. */
export function captureSnapshot(include?: SnapshotInclude[]): PageSnapshot {
  const want = (key: SnapshotInclude) => !include || include.includes(key);
  const includeBoxes = want('boxes');
  return {
    title: document.title,
    url: location.href,
    text: want('text') ? document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 12000) : '',
    controls: want('controls') ? collectControls(includeBoxes) : [],
    forms: want('forms') ? collectForms() : undefined,
    iframes: want('iframes') ? collectIframes(includeBoxes) : undefined,
    viewport: viewportInfo(),
    capturedAt: Date.now(),
    untrusted: true,
  };
}

export function getPageText(): string {
  return document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 20000);
}
