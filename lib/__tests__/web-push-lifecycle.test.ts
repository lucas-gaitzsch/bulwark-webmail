import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disableWebPush, isWebPushEnabled } from '@/lib/web-push';

const LOCAL_ACCOUNT_ID = 'alice@mail.example';
const JMAP_ACCOUNT_ID = 'jmap-1';
const METADATA_KEY = `bulwark.push.metadata.v2.${LOCAL_ACCOUNT_ID}`;

function metadata(overrides: Record<string, string> = {}) {
  return {
    localAccountId: LOCAL_ACCOUNT_ID,
    jmapAccountId: JMAP_ACCOUNT_ID,
    deviceClientId: 'device-1',
    serverSubscriptionId: 'server-sub-1',
    relayBaseUrl: 'https://custom-relay.example',
    vapidPublicKey: 'key-1',
    ...overrides,
  };
}

function installPushManager() {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const getSubscription = vi.fn().mockResolvedValue({ unsubscribe });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }),
    },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'granted' },
  });
  return { unsubscribe };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('web push lifecycle', () => {
  it('uses persisted relay ownership and removes the last browser subscription', async () => {
    const { unsubscribe } = installPushManager();
    localStorage.setItem(METADATA_KEY, JSON.stringify(metadata()));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    const client = {
      getAccountId: () => JMAP_ACCOUNT_ID,
      listPushSubscriptions: vi.fn().mockResolvedValue([{ id: 'server-sub-1' }]),
      destroyPushSubscription: vi.fn().mockResolvedValue(undefined),
    };

    await disableWebPush({ client: client as never, localAccountId: LOCAL_ACCOUNT_ID });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom-relay.example/api/push/register/device-1',
      { method: 'DELETE' },
    );
    expect(client.destroyPushSubscription).toHaveBeenCalledWith('server-sub-1');
    expect(localStorage.getItem(METADATA_KEY)).toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('retains metadata when relay cleanup fails so a later retry remains possible', async () => {
    installPushManager();
    localStorage.setItem(METADATA_KEY, JSON.stringify(metadata()));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = {
      getAccountId: () => JMAP_ACCOUNT_ID,
      listPushSubscriptions: vi.fn(),
      destroyPushSubscription: vi.fn(),
    };

    await expect(disableWebPush({
      client: client as never,
      localAccountId: LOCAL_ACCOUNT_ID,
    })).rejects.toThrow('Failed to remove the push relay registration');

    expect(localStorage.getItem(METADATA_KEY)).not.toBeNull();
    expect(client.destroyPushSubscription).not.toHaveBeenCalled();
  });

  it('reports an expired server subscription as inactive', async () => {
    installPushManager();
    localStorage.setItem(METADATA_KEY, JSON.stringify(metadata()));
    const client = {
      listPushSubscriptions: vi.fn().mockResolvedValue([{
        id: 'server-sub-1',
        expires: new Date(Date.now() - 60_000).toISOString(),
      }]),
    };

    await expect(isWebPushEnabled(
      LOCAL_ACCOUNT_ID,
      JMAP_ACCOUNT_ID,
      client as never,
    )).resolves.toBe(false);
  });
});
