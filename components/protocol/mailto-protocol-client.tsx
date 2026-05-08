"use client";

import { useEffect } from "react";
import { parseMailto } from "@/lib/protocol-handlers/mailto";
import { requestOpenMailtoInExistingClient, savePendingMailto } from "@/lib/protocol-handlers/session";

function getProtocolPathPrefix(): string {
  const marker = "/protocol/mailto";
  const index = window.location.pathname.indexOf(marker);
  return index > 0 ? window.location.pathname.slice(0, index) : "";
}

function leaveProtocolRoute() {
  window.close();

  window.setTimeout(() => {
    window.location.replace(`${getProtocolPathPrefix()}/`);
  }, 150);
}

async function focusExistingClient() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    worker?.postMessage({ type: "focus-existing-mailto-client" });
  } catch {
    // Focusing is a progressive enhancement; the composer handoff still works.
  }
}

interface MailtoProtocolClientProps {
  openingText: string;
}

export function MailtoProtocolClient({ openingText }: MailtoProtocolClientProps) {
  useEffect(() => {
    let cancelled = false;

    async function handleMailto() {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("url");
      const parsed = raw ? parseMailto(raw) : null;

      if (parsed) {
        const delivered = await requestOpenMailtoInExistingClient(parsed);
        if (cancelled) return;

        if (delivered) {
          void focusExistingClient();
          leaveProtocolRoute();
          return;
        }

        savePendingMailto(parsed);
      }

      window.location.replace(`${getProtocolPathPrefix()}/`);
    }

    void handleMailto();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>{openingText}</p>
    </main>
  );
}
