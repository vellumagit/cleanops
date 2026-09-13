import "server-only";

import { isIP } from "node:net";
import { promises as dns } from "node:dns";

/**
 * SSRF guard for user-supplied URLs (webhook targets, estimate pdf_url).
 *
 * Two layers. `isSafeOutboundUrl` is the string check, run when a URL is
 * saved AND again right before every fetch (a row can reach the table
 * without the server action — the RLS policy lets an admin insert one).
 * `assertSafeOutboundTarget` adds a DNS resolution and refuses if any
 * address the name resolves to is private, so `evil.example` pointing at
 * 10.0.0.1 is caught too. Callers also fetch with `redirect: "manual"`,
 * because a public host answering 302 to an internal address would
 * otherwise be followed by fetch on our behalf.
 *
 * Until 2026-09-13 the check compared the hostname string against a few
 * prefixes: `https://[::1]/` passed (the brackets stayed on), so did the
 * IPv4-mapped `[::ffff:169.254.169.254]`, and any DNS name at all.
 */
export function isSafeOutboundUrl(
  url: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must use https://" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "URL can't carry credentials" };
  }

  const hostname = stripBrackets(parsed.hostname.toLowerCase()).replace(/\.$/, "");
  if (!hostname) return { ok: false, reason: "Invalid URL" };

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      return { ok: false, reason: "URL can't point to a private or local address" };
    }
    return { ok: true, url: parsed };
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".arpa")
  ) {
    return { ok: false, reason: "URL can't use internal names" };
  }

  return { ok: true, url: parsed };
}

/** The string check plus a DNS resolution: every address must be public. */
export async function assertSafeOutboundTarget(
  url: string,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  const first = isSafeOutboundUrl(url);
  if (!first.ok) return first;
  const hostname = stripBrackets(first.url.hostname.toLowerCase());
  if (isIP(hostname)) return first;
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    if (addrs.length === 0) return { ok: false, reason: "Host does not resolve" };
    if (addrs.some((a) => isPrivateAddress(a.address))) {
      return { ok: false, reason: "Host resolves to a private or local address" };
    }
    return first;
  } catch {
    return { ok: false, reason: "Host does not resolve" };
  }
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Loopback, unspecified, link-local (incl. cloud metadata), RFC 1918, CGNAT,
 * multicast, and the IPv6 forms that embed those: mapped (::ffff:a.b.c.d),
 * NAT64 (64:ff9b::/96), 6to4 (2002::/16), Teredo (2001::/32), ULA, link-local.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 192 && b === 0 && p[2] === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && p[2] === 100) ||
    (a === 203 && b === 0 && p[2] === 113) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const words = expandV6(ip);
  if (!words) return true;
  const [w0, w1, w2, , , w5, w6, w7] = words;
  const allZeroTo = (n: number) => words.slice(0, n).every((w) => w === 0);
  // :: and ::1
  if (allZeroTo(7) && (w7 === 0 || w7 === 1)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
  if (allZeroTo(5) && (w5 === 0xffff || w5 === 0)) return isPrivateV4(v4FromWords(w6, w7));
  // 64:ff9b::/96 (NAT64) and 64:ff9b:1::/48 (local NAT64)
  if (w0 === 0x64 && w1 === 0xff9b) return isPrivateV4(v4FromWords(w6, w7)) || w2 === 1;
  // 2002::/16 (6to4) embeds the v4 in words 1–2
  if (w0 === 0x2002) return isPrivateV4(v4FromWords(w1, w2));
  // 2001::/32 (Teredo) embeds the server in words 2–3 and the client (inverted) in 6–7
  if (w0 === 0x2001 && w1 === 0) return true;
  // fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast
  if ((w0 & 0xfe00) === 0xfc00) return true;
  if ((w0 & 0xffc0) === 0xfe80) return true;
  if ((w0 & 0xff00) === 0xff00) return true;
  return false;
}

function v4FromWords(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** Eight 16-bit words, or null if the text is not a valid IPv6 address. */
function expandV6(ip: string): number[] | null {
  let text = ip;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // Trailing dotted-quad → two hex words.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const p = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((w) =>
    parseInt(w || "0", 16),
  );
  if (words.length !== 8 || words.some((w) => Number.isNaN(w) || w < 0 || w > 0xffff)) return null;
  return words;
}
