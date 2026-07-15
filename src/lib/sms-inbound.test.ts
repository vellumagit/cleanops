import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  classifyInboundSms,
  phoneKey,
  verifyTwilioSignature,
} from "./sms-inbound";

describe("classifyInboundSms", () => {
  it("recognizes STOP-family keywords (case/space-insensitive)", () => {
    for (const s of ["STOP", "stop", " Stop ", "UNSUBSCRIBE", "cancel", "quit", "STOP please"]) {
      expect(classifyInboundSms(s)).toBe("stop");
    }
  });

  it("recognizes START and HELP keywords", () => {
    expect(classifyInboundSms("START")).toBe("start");
    expect(classifyInboundSms("yes")).toBe("start");
    expect(classifyInboundSms("HELP")).toBe("help");
    expect(classifyInboundSms("info")).toBe("help");
  });

  it("treats a normal reply and empty input as 'other'", () => {
    expect(classifyInboundSms("thanks, see you then")).toBe("other");
    expect(classifyInboundSms("")).toBe("other");
    expect(classifyInboundSms(null)).toBe("other");
  });
});

describe("phoneKey", () => {
  it("reduces any format to the last 10 digits", () => {
    expect(phoneKey("+1 (555) 123-4567")).toBe("5551234567");
    expect(phoneKey("5551234567")).toBe("5551234567");
    expect(phoneKey("15551234567")).toBe("5551234567");
  });

  it("is empty for null/blank", () => {
    expect(phoneKey(null)).toBe("");
    expect(phoneKey("")).toBe("");
  });
});

describe("verifyTwilioSignature", () => {
  const authToken = "test_auth_token_12345";
  const url = "https://sollos3.com/api/sms/inbound";
  const params = new URLSearchParams({
    From: "+15551234567",
    To: "+15559998888",
    Body: "STOP",
    MessageSid: "SM123",
  });

  // Build the signature exactly as Twilio does: url + params sorted by key
  // (name+value concatenated), HMAC-SHA1, base64.
  function sign(u: string, p: URLSearchParams, token: string): string {
    const concat = [...p.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .reduce((acc, [k, v]) => acc + k + v, u);
    return createHmac("sha1", token).update(Buffer.from(concat, "utf-8")).digest("base64");
  }

  it("accepts a correctly-signed request", () => {
    const signature = sign(url, params, authToken);
    expect(
      verifyTwilioSignature({ candidateUrls: [url], params, signature, authToken }),
    ).toBe(true);
  });

  it("is order-independent (function sorts params itself)", () => {
    const signature = sign(url, params, authToken);
    const reordered = new URLSearchParams();
    reordered.set("MessageSid", "SM123");
    reordered.set("Body", "STOP");
    reordered.set("To", "+15559998888");
    reordered.set("From", "+15551234567");
    expect(
      verifyTwilioSignature({ candidateUrls: [url], params: reordered, signature, authToken }),
    ).toBe(true);
  });

  it("matches when the correct URL is any of several candidates", () => {
    const signature = sign(url, params, authToken);
    expect(
      verifyTwilioSignature({
        candidateUrls: ["https://wrong.example/api/sms/inbound", url],
        params,
        signature,
        authToken,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body, wrong token, wrong url, or missing signature", () => {
    const signature = sign(url, params, authToken);

    // Tampered param
    const tampered = new URLSearchParams(params);
    tampered.set("Body", "hello");
    expect(
      verifyTwilioSignature({ candidateUrls: [url], params: tampered, signature, authToken }),
    ).toBe(false);

    // Wrong auth token
    expect(
      verifyTwilioSignature({ candidateUrls: [url], params, signature, authToken: "nope" }),
    ).toBe(false);

    // Wrong URL
    expect(
      verifyTwilioSignature({
        candidateUrls: ["https://evil.example/api/sms/inbound"],
        params,
        signature,
        authToken,
      }),
    ).toBe(false);

    // Missing signature
    expect(
      verifyTwilioSignature({ candidateUrls: [url], params, signature: null, authToken }),
    ).toBe(false);
  });
});
