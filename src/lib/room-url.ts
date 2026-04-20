/**
 * Helpers for sharing a multiplayer lobby via URL.
 *
 * A host generates a room code; the same page, with `?room=CODE` appended,
 * is a direct-join link for other operators.
 */

export const ROOM_QUERY_PARAM = "room";

/**
 * Returns the current page URL with `?room=CODE` so another player can
 * open it to auto-join. Returns an empty string during SSR.
 */
export function buildRoomShareUrl(code: string): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set(ROOM_QUERY_PARAM, code);
  url.hash = "";
  return url.toString();
}

/**
 * Reads the room code from the current URL's query string, if any.
 * Returns a trimmed, upper-cased code or null.
 */
export function readRoomCodeFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(ROOM_QUERY_PARAM);
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return code || null;
}

/** Strip the `?room=` param from the URL without triggering navigation. */
export function clearRoomCodeFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(ROOM_QUERY_PARAM)) return;
  url.searchParams.delete(ROOM_QUERY_PARAM);
  window.history.replaceState({}, "", url.toString());
}

/** Copy a string to the clipboard. Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
