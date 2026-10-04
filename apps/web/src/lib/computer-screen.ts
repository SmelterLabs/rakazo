export interface ComputerScreenResult {
  url: string | null;
  error: string | null;
}

/** Only the latest request for the visible computer may replace its screen or error. */
export async function loadComputerScreen(options: {
  load: () => Promise<{ url: string | null }>;
  isCurrent: () => boolean;
  commit: (result: ComputerScreenResult) => void;
  fallbackError: string;
}): Promise<string | null> {
  let result: ComputerScreenResult;
  try {
    const screen = await options.load();
    result = { url: screen.url, error: null };
  } catch (error) {
    result = {
      url: null,
      error: error instanceof Error && error.message ? error.message : options.fallbackError,
    };
  }
  if (!options.isCurrent()) return null;
  options.commit(result);
  return result.url;
}

const SCREEN_RENEW_BEFORE_MS = 5 * 60_000;

function sealedScreenSource(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/novnc\/session\/(view|control)\/(\d+)\.[^/]+(\/.*)?$/);
    if (!match) return null;
    const expiresAt = Number(match[2]);
    if (!Number.isSafeInteger(expiresAt)) return null;
    const hint = new URLSearchParams(parsed.hash.slice(1)).get("rakazoScreen");
    return {
      expiresAt,
      identity:
        hint && /^[a-f0-9]{64}$/.test(hint)
          ? `${parsed.origin}/${match[1]}${match[3] ?? ""}#${hint}`
          : null,
    };
  } catch {
    return null;
  }
}

/** Keep a live iframe when only its seal rotated, never across a different stream. */
export function retainComputerScreenSource(
  held: string | null,
  next: string | null,
  now = Date.now(),
) {
  const current = sealedScreenSource(held);
  const incoming = sealedScreenSource(next);
  return current?.identity &&
    current.identity === incoming?.identity &&
    current.expiresAt - now > SCREEN_RENEW_BEFORE_MS
    ? held
    : next;
}

/** Renew against the link actually displayed, even if unrelated reads happened later. */
export function screenRefreshDelay(url: string | null, now = Date.now()): number | null {
  const source = sealedScreenSource(url);
  return source ? Math.max(0, source.expiresAt - now - SCREEN_RENEW_BEFORE_MS) : null;
}

export function embeddableScreenUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    const page = new URL(window.location.href);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (local && parsed.port && parsed.port !== pagePort) {
      return null;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function screenIframeSandbox(url: string | null) {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.href).pathname.startsWith("/novnc/")
      ? "allow-scripts allow-pointer-lock"
      : undefined;
  } catch {
    return undefined;
  }
}
