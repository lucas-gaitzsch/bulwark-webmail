"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { getPathPrefix } from "@/lib/browser-navigation";
import { toast } from "@/stores/toast-store";
import { SettingsSection, SettingItem } from "./settings-section";

function canRegisterProtocolHandler(): boolean {
  return typeof navigator !== "undefined"
    && "registerProtocolHandler" in navigator
    && typeof window !== "undefined"
    && window.isSecureContext;
}

function registerProtocolHandler(protocol: "mailto" | "webcal") {
  navigator.registerProtocolHandler(
    protocol,
    `${window.location.origin}${getPathPrefix()}/protocol/${protocol}?url=%s`,
  );
}

interface ProtocolHandlerSettingsProps {
  supportsCalendar: boolean;
}

export function ProtocolHandlerSettings({ supportsCalendar }: ProtocolHandlerSettingsProps) {
  const t = useTranslations("protocol_handlers");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(canRegisterProtocolHandler());
  }, []);

  const handleRegister = (protocol: "mailto" | "webcal") => {
    try {
      registerProtocolHandler(protocol);
      toast.success(protocol === "mailto" ? t("mailto_registered") : t("webcal_registered"));
    } catch {
      toast.error(t("registration_failed"));
    }
  };

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      {!supported && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t("unsupported")}
        </div>
      )}

      <SettingItem label={t("mailto_label")} description={t("mailto_description")}>
        <Button size="sm" onClick={() => handleRegister("mailto")} disabled={!supported}>
          {t("register_mailto")}
        </Button>
      </SettingItem>

      {supportsCalendar && (
        <SettingItem label={t("webcal_label")} description={t("webcal_description")}>
          <Button size="sm" onClick={() => handleRegister("webcal")} disabled={!supported}>
            {t("register_webcal")}
          </Button>
        </SettingItem>
      )}

      <p className="text-xs text-muted-foreground">{t("browser_note")}</p>
    </SettingsSection>
  );
}
