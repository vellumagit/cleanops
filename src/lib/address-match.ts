/**
 * Are two typed addresses the same place?
 *
 * Needed because the same address is stored written more than one way: a
 * client typed in by hand ("9420 58 St NW") and later picked from address
 * search ("9420 58 Street Northwest, Edmonton, AB …"). On 2026-11-14, 163 of
 * Svit's 165 upcoming visits whose address "differed" from the client's
 * were exactly that. Pure, so it is tested without a database; used by
 * src/lib/address-follow.ts.
 *
 * The rule is deliberately small: the same text once case, punctuation and
 * spacing are ignored, or the same first two words (house number and
 * street: "9420 58", "13 fulton", "903 proctor"). Two different homes on
 * one street differ in the first word; the same home written two ways
 * agrees on both.
 */
function words(address: string | null | undefined): string[] {
  return (address ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  if (wa.join(" ") === wb.join(" ")) return true;
  return wa.length >= 2 && wb.length >= 2 && wa[0] === wb[0] && wa[1] === wb[1];
}

/** Nothing typed: the visit has no address of its own and follows the client's live. */
export function hasNoAddress(address: string | null | undefined): boolean {
  return words(address).length === 0;
}
