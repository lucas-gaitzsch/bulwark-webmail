import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockClient {
  id: string;
  url: string;
  postMessage: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

const workerSource = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

function createClient(id: string, url = "https://mail.example/webmail/"): MockClient {
  return {
    id,
    url,
    postMessage: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
  };
}

function createWorker(userAgent: string, windowClients: MockClient[]) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const openedClient = createClient("opened");
  const clients = {
    claim: vi.fn(),
    matchAll: vi.fn().mockResolvedValue(windowClients),
    openWindow: vi.fn().mockResolvedValue(openedClient),
  };
  const cacheEntries = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (key: string, response: Response) => { cacheEntries.set(key, response); }),
    match: vi.fn(async (key: string) => cacheEntries.get(key)),
    delete: vi.fn(async (key: string) => cacheEntries.delete(key)),
  };
  const caches = { open: vi.fn().mockResolvedValue(cache) };
  const fetchMock = vi.fn();
  const self = {
    location: { href: "https://mail.example/webmail/sw.js", origin: "https://mail.example" },
    navigator: { userAgent },
    clients,
    caches,
    registration: { showNotification: vi.fn(), getNotifications: vi.fn().mockResolvedValue([]) },
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, listener: (event: Record<string, unknown>) => void) => {
      listeners.set(type, listener);
    }),
  };

  vm.runInNewContext(workerSource, {
    self,
    URL,
    Map,
    Object,
    Array,
    Promise,
    encodeURIComponent,
    fetch: fetchMock,
    caches,
    Response,
  });

  async function click(data: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    listeners.get("notificationclick")?.({
      notification: { data, tag: "mail", close: vi.fn() },
      waitUntil: (promise: Promise<unknown>) => { pending = promise; },
    });
    await pending;
  }

  function reportStandalone(client: MockClient) {
    listeners.get("message")?.({
      data: { type: "mailto-client-ready", standalone: true, path: "/webmail/mail" },
      source: client,
    });
  }

  async function push(data: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    listeners.get("push")?.({
      data: { json: () => data },
      waitUntil: (promise: Promise<unknown>) => { pending = promise; },
    });
    await pending;
  }

  async function registerPushAccount(jmapAccountId: string, localAccountId: string) {
    let pending: Promise<unknown> | undefined;
    listeners.get("message")?.({
      data: { type: "register-push-account", jmapAccountId, localAccountId },
      waitUntil: (promise: Promise<unknown>) => { pending = promise; },
    });
    await pending;
  }

  return { clients, openedClient, click, push, registerPushAccount, reportStandalone, self, fetchMock, cache };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("service worker notification clicks", () => {
  it("lets Android open the installed PWA instead of focusing a browser tab", async () => {
    const browserTab = createClient("browser");
    const worker = createWorker("Mozilla/5.0 (Linux; Android 15) Chrome/140", [browserTab]);

    await worker.click({ kind: "email", emailId: "message/1", accountId: "alice@mail.example" });

    expect(worker.clients.openWindow).toHaveBeenCalledWith(
      "https://mail.example/webmail/mail/message/message%2F1?account=alice%40mail.example",
    );
    expect(browserTab.navigate).not.toHaveBeenCalled();
    expect(browserTab.focus).not.toHaveBeenCalled();
    expect(worker.openedClient.focus).toHaveBeenCalledOnce();
  });

  it("navigates and focuses a running standalone PWA", async () => {
    const standalone = createClient("standalone");
    const browserTab = createClient("browser");
    const worker = createWorker("Mozilla/5.0 (Linux; Android 15) Chrome/140", [browserTab, standalone]);
    worker.reportStandalone(standalone);

    await worker.click({ kind: "email", emailId: "m1", accountId: "alice@mail.example" });

    expect(standalone.navigate).toHaveBeenCalledWith(
      "https://mail.example/webmail/mail/message/m1?account=alice%40mail.example",
    );
    expect(standalone.focus).toHaveBeenCalledOnce();
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });

  it("continues reusing an existing client on desktop", async () => {
    const browserTab = createClient("browser");
    const worker = createWorker("Mozilla/5.0 Chrome/140", [browserTab]);

    await worker.click({ kind: "mail-list", accountId: "alice@mail.example" });

    expect(browserTab.navigate).toHaveBeenCalledWith(
      "https://mail.example/webmail/mail/folder/inbox?account=alice%40mail.example",
    );
    expect(browserTab.focus).toHaveBeenCalledOnce();
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });

  it("uses the remembered account when preview fetching fails", async () => {
    const worker = createWorker("Mozilla/5.0 (iPhone)", []);
    await worker.registerPushAccount("jmap-a", "alice@mail.example");
    worker.fetchMock.mockRejectedValue(new Error("offline"));

    await worker.push({ changed: { "jmap-a": { EmailDelivery: "2" } } });

    expect(worker.self.registration.showNotification).toHaveBeenCalledWith(
      "New mail",
      expect.objectContaining({
        data: { kind: "mail-list", accountId: "alice@mail.example" },
      }),
    );
  });

  it("clears the persisted launch when Android openWindow fails and a tab is reused", async () => {
    const browserTab = createClient("browser");
    const worker = createWorker("Mozilla/5.0 (Linux; Android 15) Chrome/140", [browserTab]);
    worker.clients.openWindow.mockRejectedValue(new Error("blocked"));

    await worker.click({ kind: "email", emailId: "m1", accountId: "alice@mail.example" });

    expect(worker.cache.delete).toHaveBeenCalledWith("/webmail/__notification_launch__");
    expect(browserTab.navigate).toHaveBeenCalledWith(
      "https://mail.example/webmail/mail/message/m1?account=alice%40mail.example",
    );
    expect(browserTab.focus).toHaveBeenCalledOnce();
  });
});
