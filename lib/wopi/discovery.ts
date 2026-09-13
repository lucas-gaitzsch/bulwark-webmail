import { configManager } from '@/lib/admin/config-manager';
import { logger } from '@/lib/logger';

/**
 * WOPI client discovery (#425).
 *
 * A WOPI client (Collabora Online, OnlyOffice/EuroOffice, ...) publishes the
 * document types it can open and the editor URL for each action at
 * `<client>/hosting/discovery`:
 *
 *   <wopi-discovery><net-zone><app name="writer">
 *     <action name="edit" ext="odt" urlsrc="https://office.example/browser/abc/cool.html?"/>
 *   ...
 *
 * The admin configures `wopiClientUrl`; we fetch and cache the discovery XML
 * server-side (the URL is operator-supplied and may be on a private network,
 * so it deliberately does NOT go through the public-URL guard).
 */

export interface WopiActions {
  /** extension (lowercase, no dot) -> editor urlsrc for the "edit" action */
  edit: Record<string, string>;
  /** extension -> urlsrc for the "view" action */
  view: Record<string, string>;
}

const DISCOVERY_TTL_MS = 5 * 60 * 1000;

let discoveryCache: { url: string; fetchedAt: number; actions: WopiActions } | null = null;

export async function getWopiClientUrl(): Promise<string> {
  await configManager.ensureLoaded();
  return configManager.get<string>('wopiClientUrl', '').trim().replace(/\/+$/, '');
}

function discoveryUrlFor(clientUrl: string): string {
  try {
    const url = new URL(clientUrl);
    // A bare origin means "the editor's base URL" - discovery lives at the
    // well-known path. A URL with a path is taken as the discovery URL itself.
    if (url.pathname === '/' || url.pathname === '') {
      return `${url.origin}/hosting/discovery`;
    }
    return clientUrl;
  } catch {
    return '';
  }
}

export function parseWopiDiscovery(xml: string): WopiActions {
  const actions: WopiActions = { edit: {}, view: {} };
  const tags = xml.match(/<action\b[^>]*\/?>/gi) || [];
  for (const tag of tags) {
    const attr = (name: string): string => {
      const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
      return m?.[1] ?? '';
    };
    const name = attr('name').toLowerCase();
    const ext = attr('ext').toLowerCase();
    const urlsrc = attr('urlsrc');
    if (!ext || !urlsrc) continue;
    if (name === 'edit' && !actions.edit[ext]) actions.edit[ext] = urlsrc;
    if (name === 'view' && !actions.view[ext]) actions.view[ext] = urlsrc;
  }
  return actions;
}

/**
 * Fetch (with a short cache) the configured WOPI client's action map.
 * Returns null when no client is configured or discovery is unreachable.
 */
export async function getWopiActions(): Promise<WopiActions | null> {
  const clientUrl = await getWopiClientUrl();
  if (!clientUrl) return null;
  const discoveryUrl = discoveryUrlFor(clientUrl);
  if (!discoveryUrl) return null;

  if (
    discoveryCache &&
    discoveryCache.url === discoveryUrl &&
    Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.actions;
  }

  try {
    const res = await fetch(discoveryUrl, { headers: { Accept: 'text/xml' } });
    if (!res.ok) {
      logger.warn('WOPI discovery fetch failed', { discoveryUrl, status: res.status });
      return null;
    }
    const actions = parseWopiDiscovery(await res.text());
    if (Object.keys(actions.edit).length === 0 && Object.keys(actions.view).length === 0) {
      logger.warn('WOPI discovery returned no actions', { discoveryUrl });
      return null;
    }
    discoveryCache = { url: discoveryUrl, fetchedAt: Date.now(), actions };
    return actions;
  } catch (error) {
    logger.warn('WOPI discovery unreachable', {
      discoveryUrl,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return null;
  }
}

/**
 * Build the editor launch URL from a discovery `urlsrc` and the WOPISrc of
 * the file. Placeholder groups like `<ui=UI_LLCC&>` are optional per the WOPI
 * spec and are dropped.
 */
export function buildWopiActionUrl(urlsrc: string, wopiSrc: string): string {
  const base = urlsrc.replace(/<[^>]*>/g, '');
  const sep = base.includes('?')
    ? (base.endsWith('?') || base.endsWith('&') ? '' : '&')
    : '?';
  return `${base}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`;
}
