"use client";

import { useEffect } from "react";
import { parseMailto } from "@/lib/protocol-handlers/mailto";
import { savePendingMailto } from "@/lib/protocol-handlers/session";

function getProtocolPathPrefix(): string {
  const marker = "/protocol/mailto";
  const index = window.location.pathname.indexOf(marker);
  return index > 0 ? window.location.pathname.slice(0, index) : "";
}

export default function MailtoProtocolPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("url");

    if (raw) {
      const parsed = parseMailto(raw);
      if (parsed) {
        savePendingMailto(parsed);
      }
    }

    window.location.replace(`${getProtocolPathPrefix()}/`);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>Opening composer...</p>
    </main>
  );
}
