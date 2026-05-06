import { describe, expect, it } from "vitest";
import { parseMailto } from "../protocol-handlers/mailto";
import { parseWebcal } from "../protocol-handlers/webcal";

describe("protocol handlers", () => {
  describe("parseMailto", () => {
    it("parses a single path recipient", () => {
      expect(parseMailto("mailto:alice@example.com")).toEqual({
        to: ["alice@example.com"],
        cc: [],
        bcc: [],
        subject: "",
        body: "",
      });
    });

    it("parses multiple recipients with subject and body", () => {
      expect(parseMailto("mailto:alice@example.com,bob@example.com?subject=Hello&body=Hi")).toMatchObject({
        to: ["alice@example.com", "bob@example.com"],
        subject: "Hello",
        body: "Hi",
      });
    });

    it("parses to, cc, and bcc query recipients", () => {
      expect(parseMailto("mailto:?to=alice@example.com&cc=bob@example.com&bcc=eve@example.com")).toMatchObject({
        to: ["alice@example.com"],
        cc: ["bob@example.com"],
        bcc: ["eve@example.com"],
      });
    });

    it("decodes subject and body values", () => {
      expect(parseMailto("mailto:alice@example.com?subject=Hello%20World&body=line1%0Aline2")).toMatchObject({
        subject: "Hello World",
        body: "line1\nline2",
      });
    });

    it("preserves literal plus signs in query values", () => {
      expect(parseMailto("mailto:?to=user+tag@example.com&subject=C++&body=a+b")).toMatchObject({
        to: ["user+tag@example.com"],
        subject: "C++",
        body: "a+b",
      });
    });

    it("rejects non-mailto URLs", () => {
      expect(parseMailto("https://example.com")).toBeNull();
    });

    it("allows an empty mailto URL", () => {
      expect(parseMailto("mailto:")).toEqual({
        to: [],
        cc: [],
        bcc: [],
        subject: "",
        body: "",
      });
    });

    it("removes control characters and caps recipients", () => {
      const recipients = Array.from({ length: 250 }, (_, index) => `user${index}@example.com`).join(",");
      const parsed = parseMailto(`mailto:${recipients}?subject=Hi%0ABcc:evil@example.com`);
      expect(parsed?.to).toHaveLength(200);
      expect(parsed?.subject).toBe("HiBcc:evil@example.com");
    });
  });

  describe("parseWebcal", () => {
    it("normalizes webcal to https", () => {
      expect(parseWebcal("webcal://example.com/calendar.ics")?.subscriptionUrl).toBe("https://example.com/calendar.ics");
    });

    it("normalizes webcals to https", () => {
      expect(parseWebcal("webcals://example.com/calendar.ics")?.subscriptionUrl).toBe("https://example.com/calendar.ics");
    });

    it("accepts https URLs", () => {
      expect(parseWebcal("https://example.com/calendar.ics")?.subscriptionUrl).toBe("https://example.com/calendar.ics");
    });

    it("rejects unsupported protocols", () => {
      expect(parseWebcal("ftp://example.com/calendar.ics")).toBeNull();
    });

    it("suggests a name from the path", () => {
      expect(parseWebcal("webcal://example.com/team.ics")?.suggestedName).toBe("team");
    });

    it("falls back to hostname for suggested name", () => {
      expect(parseWebcal("webcal://example.com/")?.suggestedName).toBe("example.com");
    });

    it("prefers a name query parameter", () => {
      expect(parseWebcal("webcal://example.com/team.ics?name=Team%20Calendar")?.suggestedName).toBe("Team Calendar");
    });
  });
});
