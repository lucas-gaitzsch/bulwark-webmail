import { describe, expect, it } from 'vitest';
import { getNotificationLaunchTarget } from '@/lib/notification-launch';

describe('getNotificationLaunchTarget', () => {
  it('accepts a notification message deep link', () => {
    expect(getNotificationLaunchTarget('/mail/message/m1')).toBe(
      `${window.location.origin}/mail/message/m1`,
    );
  });

  it('accepts the generic Inbox notification target', () => {
    expect(getNotificationLaunchTarget('/mail/folder/inbox?account=alice')).toBe(
      `${window.location.origin}/mail/folder/inbox?account=alice`,
    );
  });

  it('does not intercept protocol or unrelated launches', () => {
    expect(getNotificationLaunchTarget('/protocol/mailto?url=mailto%3Aa%40example.com')).toBeNull();
    expect(getNotificationLaunchTarget('/mail/folder/archive')).toBeNull();
    expect(getNotificationLaunchTarget('/calendar')).toBeNull();
    expect(getNotificationLaunchTarget('https://other.example/mail/message/m1')).toBeNull();
  });
});
