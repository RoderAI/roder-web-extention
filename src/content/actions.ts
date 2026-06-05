/// <reference types="chrome" />

// =============================================================================
// In-page actions: click / type / keypress / scroll / select / highlight,
// resolvable by CSS selector, visible text, or stable ref (data-roder-ref).
// =============================================================================

import { REF_ATTR, ensureRef } from './snapshot';

const FOCUSABLE_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [contenteditable="true"]';

function findByText(text: string): HTMLElement | null {
  const normalized = text.trim().toLowerCase();
  const nodes = document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return (
    Array.from(nodes).find((node) => {
      const label = `${node.innerText} ${node.getAttribute('aria-label') ?? ''} ${(node as HTMLInputElement).placeholder ?? ''}`.toLowerCase();
      return label.includes(normalized);
    }) ?? null
  );
}

function findByRef(ref: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
}

/** Resolve a target element from any of ref | selector | text. */
export function resolveTarget(opts: { ref?: string; selector?: string; text?: string }): HTMLElement | null {
  if (opts.ref) return findByRef(opts.ref);
  if (opts.selector) return document.querySelector<HTMLElement>(opts.selector);
  if (opts.text) return findByText(opts.text);
  return null;
}

export function flash(element: HTMLElement): void {
  const previousOutline = element.style.outline;
  const previousBoxShadow = element.style.boxShadow;
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  element.style.outline = '3px solid #1a73e8';
  element.style.boxShadow = '0 0 0 6px rgba(26,115,232,0.25)';
  setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.boxShadow = previousBoxShadow;
  }, 1800);
}

export function highlight(opts: { ref?: string; selector?: string; text?: string }): { ref: string } {
  const target = resolveTarget(opts);
  if (!target) throw new Error('No matching element found');
  flash(target);
  return { ref: ensureRef(target) };
}

export function click(opts: { ref?: string; selector?: string; text?: string }): { ref: string } {
  const target = resolveTarget(opts);
  if (!target) throw new Error('No matching element found');
  flash(target);
  const ref = ensureRef(target);
  setTimeout(() => target.click(), 150);
  return { ref };
}

export function type(opts: { ref?: string; selector?: string; text: string; submit?: boolean }): { ref: string } {
  const target = resolveTarget(opts) as (HTMLInputElement | HTMLTextAreaElement | HTMLElement) | null;
  if (!target) throw new Error('No editable element found');
  flash(target);
  target.focus();

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.value = opts.text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (target.isContentEditable) {
    target.textContent = opts.text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    throw new Error('Target is not editable');
  }

  if (opts.submit) {
    const form = (target as HTMLInputElement).form;
    if (form) {
      form.requestSubmit?.();
    } else {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
  }
  return { ref: ensureRef(target) };
}

export function keypress(key: string): { key: string } {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const init: KeyboardEventInit = { key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keypress', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return { key };
}

export function scroll(opts: { selector?: string; dx?: number; dy?: number }): { scrolled: true } {
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  if (opts.selector) {
    const el = document.querySelector<HTMLElement>(opts.selector);
    if (!el) throw new Error('No matching element to scroll');
    el.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  } else {
    window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  }
  return { scrolled: true };
}

export function select(opts: { selector: string; value: string }): { value: string } {
  const el = document.querySelector<HTMLSelectElement>(opts.selector);
  if (!el || el.tagName !== 'SELECT') throw new Error('No matching <select> element found');
  flash(el);
  el.value = opts.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { value: el.value };
}
