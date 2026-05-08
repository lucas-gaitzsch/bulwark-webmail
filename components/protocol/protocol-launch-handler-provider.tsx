"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { parseMailto } from "@/lib/protocol-handlers/mailto";
import { parseWebcal } from "@/lib/protocol-handlers/webcal";
import {
  listenForMailtoRequests,
  notifyPendingMailto,
  notifyPendingWebcal,
  savePendingMailto,
  savePendingWebcal,
} from "@/lib/protocol-handlers/session";

type LaunchParams = { targetURL?: string };
type StandaloneNavigator = Navigator & { standalone?: boolean };

declare global {
  interface Window {
    launchQueue?: {
      setConsumer: (consumer: (launchParams: LaunchParams) => void) => void;
    };
  }
}

function getProtocolLaunch(targetURL: string):
  | { kind: "mailto"; raw: string }
  | { kind: "webcal"; raw: string }
  | null {
  let url: URL;
  try {
    url = new URL(targetURL, window.location.origin);
  } catch {
    return null;
  }

  if (url.origin !== window.location.origin) return null;

  const raw = url.searchParams.get("url");
  if (!raw) return null;

  if (url.pathname.includes("/protocol/mailto")) return { kind: "mailto", raw };
  if (url.pathname.includes("/protocol/webcal")) return { kind: "webcal", raw };
  return null;
}

function isStandaloneDisplayMode() {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as StandaloneNavigator).standalone === true;
}

interface ProtocolLaunchHandlerProviderProps {
  children: ReactNode;
}

export function ProtocolLaunchHandlerProvider({ children }: ProtocolLaunchHandlerProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/protocol/")) return;

    return listenForMailtoRequests((pending) => {
      savePendingMailto(pending);
      notifyPendingMailto();
      if (pathname !== "/") router.push("/");
    }, () => ({ path: pathname, standalone: isStandaloneDisplayMode() }));
  }, [pathname, router]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.launchQueue) return;

    window.launchQueue.setConsumer((launchParams) => {
      if (!launchParams.targetURL) return;

      const launch = getProtocolLaunch(launchParams.targetURL);
      if (!launch) return;

      if (launch.kind === "mailto") {
        const parsed = parseMailto(launch.raw);
        if (!parsed) return;
        savePendingMailto(parsed);
        notifyPendingMailto();
        if (pathname !== "/") router.push("/");
        return;
      }

      const parsed = parseWebcal(launch.raw);
      if (!parsed) return;
      savePendingWebcal(parsed);
      notifyPendingWebcal();
      if (pathname !== "/calendar") router.push("/calendar");
    });
  }, [pathname, router]);

  return children;
}
