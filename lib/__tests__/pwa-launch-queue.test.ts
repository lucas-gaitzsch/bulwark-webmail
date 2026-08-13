import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  Reflect.deleteProperty(window, 'launchQueue');
});

describe('PWA launch queue', () => {
  it('queues unmatched launches and delivers each launch to the first matching handler', async () => {
    let consumer: ((params: { targetURL?: string }) => void) | undefined;
    window.launchQueue = {
      setConsumer: vi.fn((next) => { consumer = next; }),
    };
    const { subscribeToPwaLaunches } = await import('@/lib/pwa-launch-queue');
    const unrelated = vi.fn(() => false);
    const matching = vi.fn(() => true);
    const unsubscribeUnrelated = subscribeToPwaLaunches(unrelated);
    consumer?.({ targetURL: '/protocol/mailto?url=mailto%3Aa%40example.com' });
    const unsubscribeMatching = subscribeToPwaLaunches(matching);

    expect(unrelated).toHaveBeenCalledWith('/protocol/mailto?url=mailto%3Aa%40example.com');
    expect(matching).toHaveBeenCalledWith('/protocol/mailto?url=mailto%3Aa%40example.com');

    unrelated.mockClear();
    matching.mockClear();
    consumer?.({ targetURL: '/mail/message/m1' });

    expect(unrelated).toHaveBeenCalledWith('/mail/message/m1');
    expect(matching).toHaveBeenCalledWith('/mail/message/m1');
    unsubscribeUnrelated();
    unsubscribeMatching();
  });
});
