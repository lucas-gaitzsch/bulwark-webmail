"use client";

import { useEffect } from "react";
import { parseWebcal } from "@/lib/protocol-handlers/webcal";
import { savePendingWebcal } from "@/lib/protocol-handlers/session";

function getProtocolPathPrefix(): string {
  const marker = "/protocol/webcal";
  const index = window.location.pathname.indexOf(marker);
  return index > 0 ? window.location.pathname.slice(0, index) : "";
}

export default function WebcalProtocolPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("url");

    if (raw) {
      const parsed = parseWebcal(raw);
      if (parsed) {
        savePendingWebcal(parsed);
      }
    }

    window.location.replace(`${getProtocolPathPrefix()}/calendar`);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>Opening calendar...</p>
    </main>
  );
}
