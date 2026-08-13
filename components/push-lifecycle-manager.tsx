"use client";

import { useEffect } from "react";
import { useAccountStore } from "@/stores/account-store";
import { useAuthStore } from "@/stores/auth-store";
import { usePolicyStore } from "@/stores/policy-store";
import { useSettingsStore } from "@/stores/settings-store";
import { maintainWebPush } from "@/lib/web-push";

export function PushLifecycleManager() {
  const accounts = useAccountStore((state) => state.accounts);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const emailNotificationsEnabled = useSettingsStore((state) => state.emailNotificationsEnabled);
  const relayBaseUrl = usePolicyStore((state) => state.policy.pushRelayUrl);
  const relayLocked = usePolicyStore((state) => state.policy.pushRelayUrlLocked) === true;

  useEffect(() => {
    if (!isAuthenticated) return;
    const maintain = () => {
      const auth = useAuthStore.getState();
      for (const account of accounts) {
        const client = auth.getClientForAccount(account.id);
        if (!client) continue;
        void navigator.serviceWorker?.ready.then((registration) => {
          const worker = navigator.serviceWorker.controller ?? registration.active;
          worker?.postMessage({
            type: "register-push-account",
            jmapAccountId: client.getAccountId(),
            localAccountId: account.id,
          });
        });
        if (!emailNotificationsEnabled) {
          void import("@/lib/web-push").then(({ disableWebPush }) =>
            disableWebPush({ client, localAccountId: account.id }).catch(() => {
              // Keep metadata so the cleanup retries on the next lifecycle pass.
            }));
          continue;
        }
        void maintainWebPush({
          client,
          localAccountId: account.id,
          relayBaseUrl: relayLocked ? relayBaseUrl || undefined : undefined,
          accountLabel: account.label || account.email || account.username,
        }).catch(() => {
          // Settings exposes explicit re-registration errors; maintenance stays quiet.
        });
      }
    };
    maintain();
    const timer = window.setInterval(maintain, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [accounts, emailNotificationsEnabled, isAuthenticated, relayBaseUrl, relayLocked]);

  return null;
}
