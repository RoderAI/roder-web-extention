export function tokenPreview(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '*'.repeat(token.length);
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function createId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isExtensionPage(url?: string): boolean {
  if (!url) return true;
  return /^(chrome|edge|about|devtools|chrome-extension):/i.test(url);
}

export function now(): number {
  return Date.now();
}
