import { describe, expect, it } from "vitest";
import { isPrivateAddress, isSafeOutboundUrl } from "./url-safety";

describe("isSafeOutboundUrl", () => {
  const blocked = [
    "http://example.com/hook",
    "https://localhost/",
    "https://localhost./",
    "https://127.0.0.1/",
    "https://0.0.0.0/",
    "https://10.1.2.3/",
    "https://172.16.0.9/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[::]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[64:ff9b::7f00:1]/",
    "https://[2002:7f00:1::]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://metadata.google.internal/",
    "https://printer.local/",
    "https://user:pw@example.com/",
  ];
  for (const url of blocked) {
    it(`refuses ${url}`, () => {
      expect(isSafeOutboundUrl(url).ok).toBe(false);
    });
  }

  const allowed = [
    "https://hooks.zapier.com/hooks/catch/1/abc",
    "https://8.8.8.8/",
    "https://[2606:4700:4700::1111]/",
    "https://example.com:8443/path?x=1",
  ];
  for (const url of allowed) {
    it(`allows ${url}`, () => {
      expect(isSafeOutboundUrl(url).ok).toBe(true);
    });
  }
});

describe("isPrivateAddress", () => {
  it("classifies the obvious ones", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});
