const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface PeerErrorLike {
  type?: string;
  message?: string;
}

export function makeCode(length = 5): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CHARS[(Math.random() * ROOM_CHARS.length) | 0];
  }
  return code;
}

export function describePeerError(err: PeerErrorLike | null | undefined): string {
  const type = err?.type ?? "unknown";
  const hint =
    {
      "peer-unavailable": "Room not found or offline.",
      network: "Network unavailable.",
      disconnected: "Connection dropped.",
      "server-error": "Peer relay issue.",
    }[type] ?? "Connection issue.";
  const detail = err?.message ? ` (${err.message})` : "";
  return `${hint} [${type}]${detail}`;
}

export function resetNet<T extends { destroy: () => void }>(
  peer: T | null,
  onError?: (error: unknown) => void
): null {
  if (peer) {
    try {
      peer.destroy();
    } catch (error) {
      if (onError) {
        onError(error);
      }
    }
  }
  return null;
}
