export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/**
 * Ask the browser for a real GPS fix. Returns null when the device cannot
 * provide one — coordinates are never invented to fill the gap.
 */
export function requestDeviceFix(timeoutMs = 8000): Promise<GeoFix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function formatFix(fix: GeoFix | null): string {
  if (!fix) return "No location fix available";
  const coords = `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`;
  return fix.accuracy == null ? coords : `${coords} (±${Math.round(fix.accuracy)} m)`;
}
