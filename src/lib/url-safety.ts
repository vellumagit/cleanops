import "server-only";

/**
 * Best-effort SSRF guard for user-supplied URLs (webhooks, callback URLs,
 * etc.). Call this at registration time to reject obviously-internal
 * destinations before they ever hit fetch().
 *
 * Not a full defense. True SSRF protection requires DNS resolution and
 * re-checking the resolved IP at fetch time (DNS rebinding). For our
 * threat model — a malicious customer admin pointing a webhook at
 * internal infrastructure — a string/IP-range blocklist is sufficient.
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

  const hostname = parsed.hostname.toLowerCase();

  // Loopback and unspecified addresses
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^127\./.test(hostname) ||
    /^0\./.test(hostname)
  ) {
    return { ok: false, reason: "URL can't point to localhost" };
  }

  // Private IPv4 ranges per RFC 1918 + link-local + CGNAT
  // 10.0.0.0/8
  // 172.16.0.0/12
  // 192.168.0.0/16
  // 169.254.0.0/16 (link-local, e.g. AWS instance metadata)
  // 100.64.0.0/10 (CGNAT)
  if (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
  ) {
    return { ok: false, reason: "URL can't point to a private IP range" };
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (
    /^\[?(fc|fd)[0-9a-f]{2}:/i.test(hostname) ||
    /^\[?fe[89ab][0-9a-f]:/i.test(hostname)
  ) {
    return { ok: false, reason: "URL can't point to a private IPv6 range" };
  }

  // Common internal TLDs
  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    return { ok: false, reason: "URL can't use internal TLDs" };
  }

  return { ok: true, url: parsed };
}
