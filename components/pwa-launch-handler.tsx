"use client";

import { useEffect } from "react";
import { getNotificationLaunchTarget } from "@/lib/notification-launch";
import { subscribeToPwaLaunches } from "@/lib/pwa-launch-queue";

const NOTIFICATION_LAUNCH_CACHE = "bulwark-notification-launch-v1";
const NOTIFICATION_LAUNCH_KEY = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/__notification_launch__`;

async function consumeRememberedNotificationLaunch(): Promise<void> {
  if (!("caches" in window)) return;
  const cache = await caches.open(NOTIFICATION_LAUNCH_CACHE);
  const response = await cache.match(NOTIFICATION_LAUNCH_KEY);
  if (!response) return;
  await cache.delete(NOTIFICATION_LAUNCH_KEY);
  const targetURL = await response.text();
  const notificationTarget = getNotificationLaunchTarget(targetURL);
  if (notificationTarget && notificationTarget !== window.location.href) {
    window.location.assign(notificationTarget);
  }
}

async function clearRememberedNotificationLaunch(): Promise<void> {
  if (!("caches" in window)) return;
  const cache = await caches.open(NOTIFICATION_LAUNCH_CACHE);
  await cache.delete(NOTIFICATION_LAUNCH_KEY);
}

export function PwaLaunchHandler() {
  useEffect(() => {
    void consumeRememberedNotificationLaunch();
    const navigate = (targetURL: string): boolean => {
      const notificationTarget = getNotificationLaunchTarget(targetURL);
      if (!notificationTarget) return false;
      if (notificationTarget !== window.location.href) {
        window.location.assign(notificationTarget);
      }
      return true;
    };
    const unsubscribe = subscribeToPwaLaunches(navigate);
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.kind === "notificationnavigate" && typeof event.data.targetUrl === "string") {
        void clearRememberedNotificationLaunch().then(() => navigate(event.data.targetUrl));
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleWorkerMessage);
    return () => {
      unsubscribe();
      navigator.serviceWorker?.removeEventListener("message", handleWorkerMessage);
    };
  }, []);

  return null;
}
