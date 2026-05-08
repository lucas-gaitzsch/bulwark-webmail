"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { getPathPrefix } from "@/lib/browser-navigation";
import { useSettingsStore } from "@/stores/settings-store";
import type { ProtocolOpenMode } from "@/stores/settings-store";
import { toast } from "@/stores/toast-store";
import { SettingsSection, SettingItem, Select } from "./settings-section";

const REGISTRATION_STORAGE_KEY = "bulwark:verified-protocol-handler-registrations";
type Protocol = "mailto" | "webcal";
type RegistrationState = Record<Protocol, boolean>;
type ProtocolStatusNavigator = Navigator & {
  isProtocolHandlerRegistered?: (protocol: string, url: string) => boolean | "registered" | "new" | "declined";
};

const EMPTY_REGISTRATION_STATE: RegistrationState = {
  mailto: false,
  webcal: false,
};

function canRegisterProtocolHandler(): boolean {
  return typeof navigator !== "undefined"
    && "registerProtocolHandler" in navigator
    && typeof window !== "undefined"
    && window.isSecureContext;
}

function loadRegistrationState(): RegistrationState {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRATION_STORAGE_KEY) || "{}");
    return {
      mailto: parsed.mailto === true,
      webcal: parsed.webcal === true,
    };
  } catch {
    return EMPTY_REGISTRATION_STATE;
  }
}

function saveRegistrationState(state: RegistrationState) {
  try {
    localStorage.setItem(REGISTRATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser registration still succeeded; only the local settings hint is unavailable.
  }
}

function getProtocolHandlerUrl(protocol: Protocol) {
  return `${window.location.origin}${getPathPrefix()}/protocol/${protocol}?url=%s`;
}

function readBrowserRegistrationStatus(protocol: Protocol): boolean | null {
  const statusReader = (navigator as ProtocolStatusNavigator).isProtocolHandlerRegistered;
  if (typeof statusReader !== "function") return null;

  try {
    const status = statusReader.call(navigator, protocol, getProtocolHandlerUrl(protocol));
    return status === true || status === "registered";
  } catch {
    return null;
  }
}

function registerProtocolHandler(protocol: Protocol) {
  navigator.registerProtocolHandler(
    protocol,
    getProtocolHandlerUrl(protocol),
  );
}

interface ProtocolHandlerSettingsProps {
  supportsCalendar: boolean;
}

export function ProtocolHandlerSettings({ supportsCalendar }: ProtocolHandlerSettingsProps) {
  const t = useTranslations("protocol_handlers");
  const protocolOpenMode = useSettingsStore((state) => state.protocolOpenMode);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [supported, setSupported] = useState(false);
  const [registrations, setRegistrations] = useState<RegistrationState>(EMPTY_REGISTRATION_STATE);

  useEffect(() => {
    setSupported(canRegisterProtocolHandler());
    const stored = loadRegistrationState();
    const mailtoStatus = readBrowserRegistrationStatus("mailto");
    const webcalStatus = readBrowserRegistrationStatus("webcal");
    setRegistrations({
      mailto: mailtoStatus ?? stored.mailto,
      webcal: webcalStatus ?? stored.webcal,
    });
  }, []);

  const handleOpenModeChange = async (value: string) => {
    const openMode = value as ProtocolOpenMode;

    if (openMode === "active-session"
      && typeof window !== "undefined"
      && "Notification" in window
      && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    updateSetting("protocolOpenMode", openMode);
  };

  const handleRegister = (protocol: Protocol) => {
    try {
      registerProtocolHandler(protocol);

      if (readBrowserRegistrationStatus(protocol) === true) {
        setRegistrations((current) => {
          const next = { ...current, [protocol]: true };
          saveRegistrationState(next);
          return next;
        });
      }

      toast.success(protocol === "mailto" ? t("mailto_registered") : t("webcal_registered"));
    } catch {
      toast.error(t("registration_failed"));
    }
  };

  const renderRegistrationControl = (protocol: Protocol) => {
    if (registrations[protocol]) {
      return (
        <span className="inline-flex rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground" aria-live="polite">
          {protocol === "mailto" ? t("mailto_registered") : t("webcal_registered")}
        </span>
      );
    }

    return (
      <Button size="sm" onClick={() => handleRegister(protocol)} disabled={!supported}>
        {protocol === "mailto" ? t("register_mailto") : t("register_webcal")}
      </Button>
    );
  };

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      {!supported && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t("unsupported")}
        </div>
      )}

      <SettingItem label={t("mailto_label")} description={t("mailto_description")}>
        {renderRegistrationControl("mailto")}
      </SettingItem>

      <SettingItem label={t("protocol_open_mode_label")} description={t("protocol_open_mode_description")}>
        <Select
          value={protocolOpenMode}
          onChange={handleOpenModeChange}
          options={[
            { value: "new-tab", label: t("protocol_open_mode_new_tab") },
            { value: "active-session", label: t("protocol_open_mode_active_session") },
          ]}
        />
      </SettingItem>

      {supportsCalendar && (
        <SettingItem label={t("webcal_label")} description={t("webcal_description")}>
          {renderRegistrationControl("webcal")}
        </SettingItem>
      )}

      <p className="text-xs text-muted-foreground">{t("browser_note")}</p>
    </SettingsSection>
  );
}
