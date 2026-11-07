export type Coordinates = { lat: number | null; lng: number | null };

export async function getCurrentCoordinates(): Promise<Coordinates> {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    return { lat: null, lng: null };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}
