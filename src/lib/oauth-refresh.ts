/**
 * Whether a failed OAuth token refresh means the connection is dead.
 *
 * Only the provider refusing the token is: 400 (invalid_grant: revoked,
 * expired, or already used) or 401 (invalid_client). A 5xx or 429 is the
 * provider having a bad minute, and a connection switched off for it stays
 * off until someone reconnects, long after the outage ended. On 2026-11-09 a
 * single Google 503 did exactly that to a cleaner's calendar. Google
 * Calendar, QuickBooks and Sage all use this.
 */
export function refreshFailureIsPermanent(status: number): boolean {
  return status === 400 || status === 401;
}
