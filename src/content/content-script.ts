import type { PageControl, PageSnapshot } from '../shared/types';

function cssEscape(value: string): string {
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
    const siblings = Array.from(parent.children).filter((child): child is Element => child instanceof Element && child.tagName === currentTag);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    current = parent;
  }
  return parts.join(' > ');
}

function visibleText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function collectControls(): PageControl[] {
  const nodes = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"]');
  return Array.from(nodes)
    .filter(isVisible)
    .slice(0, 120)
    .map((node) => {
      const element = node as HTMLElement;
      const input = element as HTMLInputElement;
      return {
        tag: element.tagName.toLowerCase(),
        text: visibleText(element) || input.value?.slice(0, 80) || input.placeholder?.slice(0, 80) || '',
        ariaLabel: element.getAttribute('aria-label') ?? undefined,
        name: input.name || undefined,
        id: element.id || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        selector: selectorFor(element),
      };
    });
}

function snapshot(): PageSnapshot {
  return {
    title: document.title,
    url: location.href,
    text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 12000),
    controls: collectControls(),
    capturedAt: Date.now(),
  };
}

function findByText(text: string): HTMLElement | null {
  const normalized = text.trim().toLowerCase();
  const nodes = document.querySelectorAll<HTMLElement>('a, button, input, textarea, select, [role="button"], [role="link"]');
  return Array.from(nodes).find((node) => {
    const label = `${node.innerText} ${node.getAttribute('aria-label') ?? ''} ${(node as HTMLInputElement).placeholder ?? ''}`.toLowerCase();
    return label.includes(normalized);
  }) ?? null;
}

function resolveTarget(selector?: string, text?: string): HTMLElement | null {
  if (selector) return document.querySelector<HTMLElement>(selector);
  if (text) return findByText(text);
  return null;
}

function flash(element: HTMLElement): void {
  const previousOutline = element.style.outline;
  const previousBoxShadow = element.style.boxShadow;
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  element.style.outline = '3px solid #7c3aed';
  element.style.boxShadow = '0 0 0 6px rgba(124,58,237,0.25)';
  setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.boxShadow = previousBoxShadow;
  }, 1800);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message?.type === 'snapshot') {
      sendResponse({ ok: true, snapshot: snapshot() });
      return true;
    }

    if (message?.type === 'highlight') {
      const target = resolveTarget(message.selector, message.text);
      if (!target) throw new Error('No matching element found');
      flash(target);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'click') {
      const target = resolveTarget(message.selector, message.text);
      if (!target) throw new Error('No matching element found');
      flash(target);
      setTimeout(() => target.click(), 150);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'type') {
      const target = resolveTarget(message.selector, message.textHint) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!target || !('value' in target)) throw new Error('No editable element found');
      flash(target);
      target.focus();
      target.value = message.text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      sendResponse({ ok: true });
      return true;
    }
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }

  return false;
});


