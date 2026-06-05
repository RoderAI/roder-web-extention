/// <reference types="chrome" />

// =============================================================================
// Per-origin site permissions: storage + checks.
//
// Privileged commands are gated by BOTH the global control mode / capability
// toggle AND the per-origin permission stored here. Defaults are conservative
// (only `inspect` on; everything else off).
// =============================================================================

import type { OriginPermissionEntry, SitePermission, SitePermissions } from '../shared/protocol';
import { defaultSitePermissions, storageKeys } from '../shared/protocol';

type PermissionMap = Record<string, OriginPermissionEntry>;

/** Extract the origin (scheme://host:port) from an arbitrary URL. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function loadMap(): Promise<PermissionMap> {
  const stored = await chrome.storage.local.get(storageKeys.permissions);
  const value = stored[storageKeys.permissions];
  return value && typeof value === 'object' ? (value as PermissionMap) : {};
}

async function saveMap(map: PermissionMap): Promise<void> {
  await chrome.storage.local.set({ [storageKeys.permissions]: map });
}

/** Get the resolved permission set for an origin (defaults merged in). */
export async function getPermissions(origin: string): Promise<SitePermissions> {
  const map = await loadMap();
  const entry = map[origin];
  return { ...defaultSitePermissions, ...(entry?.perms ?? {}) };
}

/** List all stored per-origin permission entries. */
export async function listPermissions(): Promise<OriginPermissionEntry[]> {
  const map = await loadMap();
  return Object.values(map).sort((a, b) => a.origin.localeCompare(b.origin));
}

/** Merge a partial permission patch into an origin's entry. */
export async function setPermissions(origin: string, perms: Partial<SitePermissions>): Promise<SitePermissions> {
  const map = await loadMap();
  const current = map[origin]?.perms ?? defaultSitePermissions;
  const merged: SitePermissions = { ...defaultSitePermissions, ...current, ...perms };
  map[origin] = { origin, perms: merged, updatedAt: Date.now() };
  await saveMap(map);
  return merged;
}

/** Remove an origin's stored permissions entirely (reverts to defaults). */
export async function removePermissions(origin: string): Promise<void> {
  const map = await loadMap();
  delete map[origin];
  await saveMap(map);
}

/** Check a single permission for the origin derived from a URL. */
export async function checkPermission(url: string | undefined, perm: SitePermission): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return false;
  const perms = await getPermissions(origin);
  return Boolean(perms[perm]);
}

/** Does the origin require explicit per-action approval (i.e. not alwaysAllow)? */
export async function requiresApproval(url: string | undefined): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return true;
  const perms = await getPermissions(origin);
  return !perms.alwaysAllow;
}
