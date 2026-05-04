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

  // Best effort: ask the webmail to look up the latest unread email so we can
  // build a useful notification. If the request fails (offline, session
  // expired, server down) we fall back to a generic "New mail" so the user
  // still sees something.
  let preview = null;
  let previewOk = false;
  try {
    const res = await fetch(`${BASE_PATH}/api/push/preview`, {
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
  let tag = "bulwark-mail";
  let data = { kind: "mail-list" };

  if (email) {
    const sender = email.from && email.from[0];
    const senderName = (sender && sender.name) || (sender && sender.email) || "New mail";
    title = senderName + (accountLabel ? ` (${accountLabel})` : "");
    body = email.subject || email.preview || "(no subject)";
    tag = "bulwark-mail:" + email.id;
    data = {
      kind: "email",
      emailId: email.id,
      threadId: email.threadId,
    };
  } else {
    title = accountLabel ? `New mail (${accountLabel})` : "New mail";
    body = unreadTotal > 1 ? `${unreadTotal} unread messages` : "You have new mail";
  }

  await self.registration.showNotification(title, {
    body,
    tag,
    icon: `${BASE_PATH}/icon-192x192.png`,
    badge: `${BASE_PATH}/icon-192x192.png`,
    data,
    renotify: true,
  });
}

async function handleNotificationClick(event) {
  const data = event.notification.data || {};
  const tag = event.notification.tag || "";
  const targetUrl = buildClickUrl(data);

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

  for (const client of allClients) {
    // Reuse an existing tab whenever possible - users on desktop browsers
    // get annoyed when each notification opens a fresh window.
    if ("focus" in client) {
      try {
        if ("navigate" in client && targetUrl) {
          await client.navigate(targetUrl);
        }
        return client.focus();
      } catch (_) {
        // navigate() can reject for cross-origin or detached clients - fall
        // through and open a new window below.
      }
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl || `${BASE_PATH}/`);
  }
}

function buildClickUrl(data) {
  if (!data) return `${BASE_PATH}/`;
  if (data.kind === "email" && data.emailId) {
    return `${BASE_PATH}/?email=${encodeURIComponent(data.emailId)}`;
  }
  // Generic "New mail" toast (preview API failed or returned no email): land
  // the user on the latest unread message in their Inbox rather than just the
  // app shell, so the click still feels purposeful.
  return `${BASE_PATH}/?openLatestUnread=1`;
}
