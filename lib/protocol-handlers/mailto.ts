export interface ParsedMailto {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

const MAX_RECIPIENTS = 200;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 64 * 1024;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const CONTROL_CHARS_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

function stripBodyControlChars(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS_EXCEPT_LINE_BREAKS, "");
}

function splitRecipients(value: string): string[] {
  return stripControlChars(value)
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

function getQueryValue(searchParams: URLSearchParams, key: string): string {
  const values: string[] = [];
  const lowerKey = key.toLowerCase();

  for (const [paramKey, value] of searchParams.entries()) {
    if (paramKey.toLowerCase() === lowerKey) {
      values.push(value);
    }
  }

  return values.join(",");
}

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname || "");
  } catch {
    return null;
  }
}

export function parseMailto(raw: string): ParsedMailto | null {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "mailto:") return null;

  const decodedPathname = decodePathname(url.pathname);
  if (decodedPathname === null) return null;

  const to = [
    ...splitRecipients(decodedPathname),
    ...splitRecipients(getQueryValue(url.searchParams, "to")),
  ].slice(0, MAX_RECIPIENTS);
  const remainingAfterTo = Math.max(0, MAX_RECIPIENTS - to.length);
  const cc = splitRecipients(getQueryValue(url.searchParams, "cc")).slice(0, remainingAfterTo);
  const remainingAfterCc = Math.max(0, MAX_RECIPIENTS - to.length - cc.length);
  const bcc = splitRecipients(getQueryValue(url.searchParams, "bcc")).slice(0, remainingAfterCc);

  return {
    to,
    cc,
    bcc,
    subject: stripControlChars(getQueryValue(url.searchParams, "subject")).slice(0, MAX_SUBJECT_LENGTH),
    body: stripBodyControlChars(getQueryValue(url.searchParams, "body")).slice(0, MAX_BODY_LENGTH),
  };
}
