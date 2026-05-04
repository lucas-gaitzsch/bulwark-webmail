import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Block telemetry endpoints from pointing at internal/loopback addresses.
// Required because the admin UI lets an authenticated admin set an arbitrary
// URL; without this an attacker with a session (or a hostile admin in a
// multi-tenant deploy) could redirect heartbeats at internal hosts.
//
// Set BULWARK_TELEMETRY_ALLOW_PRIVATE=1 to bypass - useful only for local
// dev where the collector is on the loopback.

const PRIVATE_V4: RegExp[] = [
  /^0\./,                                          // 0.0.0.0/8
  /^10\./,                                         // 10.0.0.0/8
  /^127\./,                                        // loopback
  /^169\.254\./,                                   // link-local + cloud metadata
  /^172\.(1[6-9]|2\d|3[0-1])\./,                   // 172.16.0.0/12
  /^192\.168\./,                                   // 192.168.0.0/16
  /^192\.0\.0\./,                                  // IETF reserved
  /^198\.(1[8-9])\./,                              // benchmarking 198.18.0.0/15
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,      // 100.64.0.0/10 CGNAT
  /^22[4-9]\./,                                    // 224.0.0.0/4 multicast
  /^23\d\./,
  /^2[4-5]\d\./,                                   // 240.0.0.0/4 reserved
];

function isPrivateV4(ip: string): boolean {
  return PRIVATE_V4.some((re) => re.test(ip));
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;     // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;     // fc00::/7 ULA
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return false;
}

const BAD_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

function bypassEnabled(): boolean {
  return process.env.BULWARK_TELEMETRY_ALLOW_PRIVATE === '1';
}

export type EndpointCheck = { ok: true } | { ok: false; reason: string };

// Sync URL/host shape check. Catches the obvious cases without DNS.
export function validateEndpointUrl(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'must be http(s)://' };
  }
  if (bypassEnabled()) return { ok: true };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'host required' };
  if (BAD_HOSTS.has(host)) {
    return { ok: false, reason: 'localhost endpoints are not allowed' };
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: 'private TLDs are not allowed' };
  }
  if (isIP(host) && isPrivateAddress(host)) {
    return { ok: false, reason: 'private/loopback IP is not allowed' };
  }
  return { ok: true };
}

// Async check that additionally resolves DNS hostnames. Use this on
// set-endpoint AND immediately before fetch to defeat DNS-rebinding tricks
// where a hostname resolves to a public IP at validation time and a private
// one at fetch time.
export async function resolveEndpointAllowed(raw: string): Promise<EndpointCheck> {
  const initial = validateEndpointUrl(raw);
  if (!initial.ok) return initial;
  if (bypassEnabled()) return { ok: true };

  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) return { ok: true };

  try {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        return { ok: false, reason: `host ${host} resolves to private address ${a.address}` };
      }
    }
    return { ok: true };
  } catch {
    // Don't block on transient DNS failures - fetch will fail loudly anyway,
    // and we don't want to lock admins out of their config when the resolver
    // is flaky. The literal-IP check above already covers the direct-attack
    // case.
    return { ok: true };
  }
}
