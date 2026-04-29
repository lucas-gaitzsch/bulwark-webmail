import type { ParsedMailto } from "./mailto";
import type { ParsedWebcal } from "./webcal";

const MAILTO_KEY = "bulwark:pending-mailto";
const WEBCAL_KEY = "bulwark:pending-webcal";
const PENDING_TTL_MS = 5 * 60 * 1000;

type PendingValue<T> = T & { createdAt: number };

function savePending<T>(key: string, value: T) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...value, createdAt: Date.now() }));
  } catch {
    // Storage can be unavailable in hardened/private browser modes.
  }
}

function consumePending<T>(key: string, validate: (value: unknown) => value is T): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingValue<unknown>;
    if (typeof parsed.createdAt !== "number" || Date.now() - parsed.createdAt > PENDING_TTL_MS) {
      return null;
    }
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isParsedMailto(value: unknown): value is ParsedMailto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParsedMailto>;
  return Array.isArray(candidate.to)
    && Array.isArray(candidate.cc)
    && Array.isArray(candidate.bcc)
    && typeof candidate.subject === "string"
    && typeof candidate.body === "string";
}

function isParsedWebcal(value: unknown): value is ParsedWebcal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParsedWebcal>;
  return typeof candidate.originalUrl === "string"
    && typeof candidate.subscriptionUrl === "string"
    && typeof candidate.suggestedName === "string";
}

export function savePendingMailto(value: ParsedMailto) {
  savePending(MAILTO_KEY, value);
}

export function consumePendingMailto(): ParsedMailto | null {
  return consumePending(MAILTO_KEY, isParsedMailto);
}

export function savePendingWebcal(value: ParsedWebcal) {
  savePending(WEBCAL_KEY, value);
}

export function consumePendingWebcal(): ParsedWebcal | null {
  return consumePending(WEBCAL_KEY, isParsedWebcal);
}
