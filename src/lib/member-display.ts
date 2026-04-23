/**
 * Membership display-name resolver.
 *
 * Shadow memberships (profile_id IS NULL) don't have a linked profiles row,
 * so profile.full_name is unavailable. This helper gives every caller a
 * consistent fallback chain:
 *
 *   display_name → profile.full_name → "Unknown"
 *
 * Use this anywhere the app renders a cleaner's/manager's name from a
 * memberships row so invited members and manually-added members both look
 * the same in the UI.
 */
export function memberDisplayName(m: {
  display_name?: string | null;
  profile?: { full_name?: string | null } | null;
}): string {
  const explicit = m.display_name?.trim();
  if (explicit) return explicit;
  const fromProfile = m.profile?.full_name?.trim();
  if (fromProfile) return fromProfile;
  return "Unknown";
}
