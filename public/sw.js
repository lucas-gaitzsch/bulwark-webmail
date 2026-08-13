/* eslint-disable no-undef */

// Bulwark service worker.
//
// This SW does two jobs:
//   1. Satisfy the PWA installability requirement (network-only fetch handler,
//      no caching - so we never serve stale chunks after a deployment).
//   2. Receive Web Push wake-up pings from the relay and turn them into
//      enriched system notifications. Mirrors the React Native FCM headless
//      task: relay sends only a state-change ping, the client fetches the
//      newest unread email itself so the relay never sees mail content.

// When the app is mounted at a subpath (Next.js basePath, e.g. /webmail), the
// SW is served at /webmail/sw.js and registered with scope /webmail/. Derive
// the prefix from the SW's own URL so push fetches and notification clicks
// land on the right path - service workers can't read process.env.
function getBasePath() {
  const path = new URL(self.location.href).pathname;
  // self.location is .../sw.js; strip the trailing filename to get the dir,
  // then strip the trailing slash so it concatenates cleanly with `/foo`.
  const dir = path.replace(/[^/]*$/, "");
  return dir.replace(/\/+$/, "");
}

const BASE_PATH = getBasePath();
const MAILTO_CLIENTS = new Map();
const NOTIFICATION_LAUNCH_CACHE = "bulwark-notification-launch-v1";
const NOTIFICATION_LAUNCH_KEY = `${BASE_PATH}/__notification_launch__`;
const PUSH_ACCOUNT_CACHE = "bulwark-push-accounts-v1";
const DISABLED_PUSH_ACCOUNT_CACHE = "bulwark-disabled-push-accounts-v1";
const AMBIGUOUS_ACCOUNT = "__ambiguous__";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "register-push-account"
    && typeof data.jmapAccountId === "string"
    && typeof data.localAccountId === "string") {
    event.waitUntil(rememberPushAccount(data.jmapAccountId, data.localAccountId));
    return;
  }
  if (data.type === "disable-push-account" && typeof data.jmapAccountId === "string") {
    event.waitUntil(disablePushAccount(data.jmapAccountId, data.localAccountId));
    return;
  }
  if (data.type === "mailto-client-ready") {
    if (event.source && event.source.id) {
      MAILTO_CLIENTS.set(event.source.id, {
        path: typeof data.path === "string" ? data.path : "",
        standalone: data.standalone === true,
        clientId: typeof data.clientId === "string" ? data.clientId : "",
        focusNotificationTitle: typeof data.focusNotificationTitle === "string" ? data.focusNotificationTitle : "",
        focusNotificationBody: typeof data.focusNotificationBody === "string" ? data.focusNotificationBody : "",
      });
    }
    return;
  }

  if (data.type === "mailto-client-gone") {
    if (event.source && event.source.id) {
      const current = MAILTO_CLIENTS.get(event.source.id);
      if (!current
        || (typeof data.clientId === "string" && current.clientId === data.clientId)
        || (typeof data.clientId !== "string" && typeof data.path === "string" && current.path === data.path)) {
        MAILTO_CLIENTS.delete(event.source.id);
      }
    }
    return;
  }

  if (data.type === "open-mailto-in-client") {
    event.waitUntil(handleOpenMailtoInClient(event));
    return;
  }

  if (data.type === "focus-existing-mailto-client") {
    event.waitUntil(focusExistingWindowClient(event.source && event.source.id, true));
    return;
  }

  if (data.type !== "focus-existing-client") return;

  event.waitUntil(focusExistingWindowClient(event.source && event.source.id));
});

async function handlePush(event) {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch (_) {
    payload = null;
  }

  const accountLabel = (payload && typeof payload.accountLabel === "string")
    ? payload.accountLabel
    : "";
  const payloadAccountId = (payload && typeof payload.accountId === "string")
    ? payload.accountId
    : "";

  // JMAP StateChange wraps changes in { changed: { [accountId]: {...} } }.
  // The relay forwards a single account's StateChange per push, so the first
  // key is the one this notification is for. Without this the preview API
  // would just fall back to the first signed-in slot and surface mail from
  // the wrong account.
  const changed = payload && payload.changed && typeof payload.changed === "object"
    ? payload.changed
    : null;
  const accountId = changed ? Object.keys(changed)[0] || "" : "";
  const rememberedAccountId = accountId ? await readPushAccount(accountId) : "";
  const effectiveLocalAccountId = payloadAccountId || rememberedAccountId;
  if (accountId && await isPushAccountDisabled(accountId, effectiveLocalAccountId)) return;

  // Best effort: ask the webmail to look up the latest unread email so we can
  // build a useful notification. If the request fails (offline, session
  // expired, server down) we fall back to a generic "New mail" so the user
  // still sees something.
  let preview = null;
  let previewOk = false;
  try {
    const previewUrl = accountId
      ? `${BASE_PATH}/api/push/preview?accountId=${encodeURIComponent(accountId)}${effectiveLocalAccountId ? `&localAccountId=${encodeURIComponent(effectiveLocalAccountId)}` : ""}`
      : `${BASE_PATH}/api/push/preview`;
    const res = await fetch(previewUrl, {
      credentials: "include",
      cache: "no-store",
    });
    if (res.ok) {
      preview = await res.json();
      previewOk = true;
    }
  } catch (_) {
    preview = null;
  }

  const email = preview && preview.email ? preview.email : null;
  const unreadTotal = preview && typeof preview.unreadTotal === "number"
    ? preview.unreadTotal
    : 0;
  const localAccountId = preview && typeof preview.accountId === "string"
    ? preview.accountId
    : effectiveLocalAccountId;
  const notificationAccountKey = localAccountId || accountId;

  // Push subscription is scoped to EmailDelivery, but stragglers from the
  // older broader-types subscription, marking-as-read races and verification
  // pings can still wake us with no actual unread mail. When the preview API
  // succeeded and reports zero unread, stay silent. When the preview API
  // failed (network/auth/server down) we cannot tell, so fall through to the
  // generic "New mail" toast rather than miss a real delivery.
  if (previewOk && !email && unreadTotal === 0) {
    return;
  }

  let title;
  let body;
  let tag = "bulwark-mail" + (notificationAccountKey ? `:${notificationAccountKey}` : "");
  let data = { kind: "mail-list", accountId: localAccountId };

  if (email) {
    const sender = email.from && email.from[0];
    const senderName = (sender && sender.name) || (sender && sender.email) || "New mail";
    title = senderName + (accountLabel ? ` (${accountLabel})` : "");
    body = email.subject || email.preview || "(no subject)";
    tag = "bulwark-mail:" + (notificationAccountKey ? `${notificationAccountKey}:` : "") + email.id;
    data = {
      kind: "email",
      emailId: email.id,
      threadId: email.threadId,
      accountId: localAccountId,
    };
  } else {
    title = accountLabel ? `New mail (${accountLabel})` : "New mail";
    body = unreadTotal > 1 ? `${unreadTotal} unread messages` : "You have new mail";
  }

  await self.registration.showNotification(title, {
    body,
    tag,
    // Branded app icon via the PWA-icon endpoint (admin-configured, else the
    // built-in default). The static /icon-192x192.png ignored admin branding.
    icon: `${BASE_PATH}/api/pwa-icon/192`,
    badge: `${BASE_PATH}/api/pwa-icon/192`,
    data,
    renotify: true,
  });
}

async function handleNotificationClick(event) {
  const data = event.notification.data || {};
  const tag = event.notification.tag || "";

  if (data.kind === "protocol-mailto-focus") {
    return handleMailtoFocusNotificationClick();
  }

  const targetUrl = buildClickUrl(data);
  const absoluteTargetUrl = new URL(targetUrl, self.location.origin).href;

  const allClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  // Notify any in-app clients so plugins listening on toastHooks.onNotificationClick fire.
  for (const client of allClients) {
    try {
      client.postMessage({ kind: "notificationclick", tag, data });
    } catch (_) {
      // Closed or detached client - ignore.
    }
  }

  // WindowClient does not expose its display mode. The app reports it through
  // MAILTO_CLIENTS, so prefer a running standalone window when one is known.
  const standaloneClient = allClients.find((client) => MAILTO_CLIENTS.get(client.id)?.standalone === true);
  if (standaloneClient && "focus" in standaloneClient) {
    try {
      const navigatedClient = "navigate" in standaloneClient
        ? await standaloneClient.navigate(absoluteTargetUrl)
        : standaloneClient;
      return await (navigatedClient || standaloneClient).focus();
    } catch {
      // Detached client - fall through to opening the installed app/window.
    }
  }

  // Chrome for Android routes openWindow() URLs inside the manifest scope to
  // the installed WebAPK/PWA. Do this before focusing arbitrary browser tabs;
  // otherwise a background Chrome tab can swallow the notification click.
  const isAndroid = /\bAndroid\b/i.test(self.navigator?.userAgent || "");
  if (isAndroid && self.clients.openWindow) {
    await rememberNotificationLaunch(absoluteTargetUrl);
    try {
      const openedClient = await self.clients.openWindow(absoluteTargetUrl);
      if (openedClient && "focus" in openedClient) {
        openedClient.postMessage({ kind: "notificationnavigate", targetUrl: absoluteTargetUrl });
        return await openedClient.focus();
      }
      if (openedClient) return openedClient;
    } catch {
      // Fall back to a live client if the browser rejects opening a window.
      await forgetNotificationLaunch();
    }
  }

  // Preserve desktop behaviour: reuse a browser window rather than opening a
  // new tab for every notification.
  for (const client of allClients) {
    if (!("focus" in client)) continue;
    try {
      const navigatedClient = "navigate" in client
        ? await client.navigate(absoluteTargetUrl)
        : client;
      return await (navigatedClient || client).focus();
    } catch {
      // Closed or detached client - try the next one.
    }
  }

  if (self.clients.openWindow) {
    await rememberNotificationLaunch(absoluteTargetUrl);
    return self.clients.openWindow(absoluteTargetUrl);
  }
}

async function rememberNotificationLaunch(targetUrl) {
  if (!("caches" in self)) return;
  try {
    const cache = await caches.open(NOTIFICATION_LAUNCH_CACHE);
    await cache.put(NOTIFICATION_LAUNCH_KEY, new Response(targetUrl, {
      headers: { "content-type": "text/plain" },
    }));
  } catch {
    // Navigation still proceeds; this is only a fallback for WebKit launches.
  }
}

async function forgetNotificationLaunch() {
  if (!("caches" in self)) return;
  try {
    const cache = await caches.open(NOTIFICATION_LAUNCH_CACHE);
    await cache.delete(NOTIFICATION_LAUNCH_KEY);
  } catch {
    // Best-effort cleanup; fallback navigation can still continue.
  }
}

async function rememberPushAccount(jmapAccountId, localAccountId) {
  if (!("caches" in self)) return;
  const cache = await caches.open(PUSH_ACCOUNT_CACHE);
  const key = `${BASE_PATH}/__push_account__/${encodeURIComponent(jmapAccountId)}`;
  const existing = await cache.match(key);
  const existingAccountId = existing ? await existing.text() : "";
  const storedAccountId = existingAccountId && existingAccountId !== localAccountId
    ? AMBIGUOUS_ACCOUNT
    : localAccountId;
  await cache.put(key, new Response(storedAccountId));
  const disabled = await caches.open(DISABLED_PUSH_ACCOUNT_CACHE);
  await disabled.delete(`${BASE_PATH}/__disabled_push_account__/${encodeURIComponent(localAccountId)}`);
}

async function readPushAccount(jmapAccountId) {
  if (!("caches" in self)) return "";
  try {
    const cache = await caches.open(PUSH_ACCOUNT_CACHE);
    const response = await cache.match(`${BASE_PATH}/__push_account__/${encodeURIComponent(jmapAccountId)}`);
    const accountId = response ? await response.text() : "";
    return accountId === AMBIGUOUS_ACCOUNT ? "" : accountId;
  } catch {
    return "";
  }
}

async function disablePushAccount(jmapAccountId, localAccountId) {
  if (!("caches" in self)) return;
  const cache = await caches.open(DISABLED_PUSH_ACCOUNT_CACHE);
  const key = localAccountId || jmapAccountId;
  await cache.put(`${BASE_PATH}/__disabled_push_account__/${encodeURIComponent(key)}`, new Response("1"));
  const notifications = await self.registration.getNotifications();
  for (const notification of notifications) {
    const data = notification.data || {};
    if ((localAccountId && data.accountId === localAccountId)
      || (!localAccountId && notification.tag?.includes(jmapAccountId))) {
      notification.close();
    }
  }
}

async function isPushAccountDisabled(jmapAccountId, localAccountId) {
  if (!("caches" in self)) return false;
  try {
    const cache = await caches.open(DISABLED_PUSH_ACCOUNT_CACHE);
    const key = localAccountId || jmapAccountId;
    return !!(await cache.match(`${BASE_PATH}/__disabled_push_account__/${encodeURIComponent(key)}`));
  } catch {
    return false;
  }
}

async function focusExistingWindowClient(sourceClientId, requireMailtoReady) {
  const entry = await findReusableWindowClientEntry(sourceClientId, requireMailtoReady);
  const client = entry && entry.client;
  if (client && "focus" in client) {
    return client.focus();
  }
}

async function handleMailtoFocusNotificationClick() {
  const entry = await findReusableWindowClientEntry(null, true);
  const client = entry && entry.client;
  if (client && "focus" in client) {
    try {
      return await client.focus();
    } catch (_) {
      // Fall through to opening a new app window if activation is still blocked.
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(`${BASE_PATH}/`);
  }
}

async function handleOpenMailtoInClient(event) {
  const data = event.data || {};
  const responsePort = event.ports && event.ports[0];
  const entry = await findReusableWindowClientEntry(event.source && event.source.id, true);
  const client = entry && entry.client;
  const state = entry && entry.state;

  if (!client || !state || !state.clientId) {
    responsePort && responsePort.postMessage({ delivered: false });
    return;
  }

  try {
    client.postMessage({ type: "mailto-request", id: data.id, clientId: state.clientId, value: data.value });
  } catch (_) {
    responsePort && responsePort.postMessage({ delivered: false });
    return;
  }

  if ("focus" in client) {
    try {
      await client.focus();
    } catch (_) {
      // Delivery succeeded; focusing can still be blocked by browser policy.
      await showMailtoFocusNotification(state);
    }
  }

  responsePort && responsePort.postMessage({ delivered: true });
}

async function showMailtoFocusNotification(state) {
  try {
    await self.registration.showNotification(state.focusNotificationTitle || "Bulwark", {
      body: state.focusNotificationBody || "The request was opened in Bulwark. Click to bring it to the front.",
      tag: "bulwark-mailto-focus",
      icon: `${BASE_PATH}/api/pwa-icon/192`,
      badge: `${BASE_PATH}/api/pwa-icon/192`,
      data: { kind: "protocol-mailto-focus" },
      renotify: true,
    });
  } catch (_) {
    // Notification permission may be missing; the mailto request was still delivered.
  }
}

async function findReusableWindowClientEntry(sourceClientId, requireMailtoReady) {
  const scopedPath = BASE_PATH ? `${BASE_PATH}/` : "/";
  const allClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const candidates = [];

  for (const client of allClients) {
    if (client.id === sourceClientId) continue;
    const state = MAILTO_CLIENTS.get(client.id);
    if (requireMailtoReady && !state) continue;

    try {
      const url = new URL(client.url);
      if (url.origin !== self.location.origin) continue;
      if (!url.pathname.startsWith(scopedPath)) continue;
      if (url.pathname.includes("/protocol/")) continue;

      candidates.push({ client, state, score: getReusableClientScore(state) });
    } catch (_) {
      // Detached clients can disappear while iterating.
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0];
}

/**
 * Whether a client's path is the mail section. Since #733 the mail client
 * keeps a permalink in the address bar, so an open inbox reads as
 * `/mail/folder/inbox` (optionally behind a mount prefix and a locale
 * segment) rather than a bare "/".
 *
 * Deliberately duplicated from lib/deep-links.ts: this file is served raw, not
 * bundled, so it cannot import from the app. The locale segment is matched by
 * shape (two lowercase letters) because the worker has no locale list - and no
 * app route is a bare two-letter segment.
 */
function isMailSectionPath(path) {
  if (!path) return true;
  let rest = path;
  if (BASE_PATH && (rest === BASE_PATH || rest.startsWith(`${BASE_PATH}/`))) {
    rest = rest.slice(BASE_PATH.length);
  }
  const segments = rest.split("/").filter(Boolean);
  if (segments.length > 0 && /^[a-z]{2}$/.test(segments[0])) segments.shift();
  return segments.length === 0 || segments[0] === "mail";
}

function getReusableClientScore(state) {
  if (!state) return 4;

  const isMailSection = isMailSectionPath(state.path);
  if (state.standalone && isMailSection) return 0;
  if (isMailSection) return 1;
  if (state.standalone) return 2;
  return 3;
}

function buildClickUrl(data) {
  if (!data) return `${BASE_PATH}/`;
  const accountQuery = data.accountId
    ? `?account=${encodeURIComponent(data.accountId)}`
    : "";
  if (data.kind === "email" && data.emailId) {
    // Permalink (#733). Under NEXT_PUBLIC_LOCALE_PREFIX=always the proxy
    // redirects this to the localised path; the worker has no locale to add.
    return `${BASE_PATH}/mail/message/${encodeURIComponent(data.emailId)}${accountQuery}`;
  }
  // Generic notifications still carry their account when preview resolution
  // succeeded, so at minimum they open the correct account's Inbox.
  return `${BASE_PATH}/mail/folder/inbox${accountQuery}`;
}
