import { matchSurface } from '@/lib/deep-links';

/**
 * Recognises the URLs produced by the push notification click handler. Other
 * PWA launches, especially mailto/webcal protocol handlers, must keep their
 * existing launch behaviour.
 */
export function getNotificationLaunchTarget(targetURL: string): string | null {
  let url: URL;
  try {
    url = new URL(targetURL, window.location.origin);
  } catch {
    return null;
  }

  if (url.origin !== window.location.origin) return null;

  const match = matchSurface(url.pathname);
  if (!match || match.surface !== 'mail') return null;

  const isMessage = match.segments[0] === 'message' && !!match.segments[1];
  const isInbox = match.segments[0] === 'folder' && match.segments[1] === 'inbox';
  return isMessage || isInbox ? url.href : null;
}
