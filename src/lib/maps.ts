/**
 * Map deep-link helpers.
 *
 * Google Maps and Apple Maps use different URL schemes and each only opens
 * its own native app. We pick per-platform at click time (see
 * <OpenInMaps>): Apple devices → Apple Maps, everything else → Google Maps.
 */

/** Google Maps search URL — opens the Google Maps app on Android, web elsewhere. */
export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Apple Maps search URL — opens the Maps app on iOS / iPadOS / macOS. */
export function appleMapsUrl(address: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
}
