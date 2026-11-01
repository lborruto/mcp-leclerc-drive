/**
 * Guards around the Chrome instance the server drives.
 *
 * - Never on the user's main browser profile: the server only ever uses its
 *   own dedicated profile, so a debug port never exposes the user's everyday
 *   browsing, and the server never sees other sites' sessions.
 * - Never attach to a Chrome it did not start. A debug port lets whoever
 *   connects drive the browser, so something already listening on the port
 *   could be anyone's Chrome (or not Chrome at all). When the server starts
 *   Chrome it writes a lock in the profile: Chrome's PID, the port, and the
 *   browser's DevTools id (`/devtools/browser/<uuid>`, random for each Chrome
 *   run). Later it only reuses a Chrome on that port if the lock names that
 *   port, that PID is alive, and /json/version reports that same browser id.
 *   (Chrome's DevToolsActivePort file is not written for a fixed port on every
 *   platform, so it is checked only when present.)
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { BlockingError } from "./errors.js";

export const LOCK_FILE = "mcp-leclerc-drive.lock";

interface Lock {
  pid: number;
  port: number;
  /** `/devtools/browser/<id>`: random per Chrome run, reported by /json/version. */
  browser: string;
  startedAt?: string;
}

/**
 * The default user-data folders of Chrome and the Chromium browsers people
 * commonly point LECLERC_CHROME_PATH at, per OS.
 */
export function mainProfileDirs(
  os: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): string[] {
  if (os === "darwin") {
    const base = join(home, "Library", "Application Support");
    return [
      "Google/Chrome",
      "Google/Chrome Beta",
      "Google/Chrome Dev",
      "Google/Chrome Canary",
      "Chromium",
      "Microsoft Edge",
      "BraveSoftware/Brave-Browser",
    ].map((d) => join(base, ...d.split("/")));
  }
  if (os === "win32") {
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      "Google/Chrome/User Data",
      "Google/Chrome Beta/User Data",
      "Google/Chrome Dev/User Data",
      "Google/Chrome SxS/User Data",
      "Chromium/User Data",
      "Microsoft/Edge/User Data",
      "BraveSoftware/Brave-Browser/User Data",
    ].map((d) => join(local, ...d.split("/")));
  }
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  return [
    "google-chrome",
    "google-chrome-beta",
    "google-chrome-unstable",
    "chromium",
    "microsoft-edge",
    "BraveSoftware/Brave-Browser",
  ].map((d) => join(config, ...d.split("/")));
}

/**
 * Absolute, symlinks and Windows 8.3 short names resolved. For a folder not
 * created yet, its nearest existing parent is resolved and the rest appended.
 */
function canonical(p: string, os: NodeJS.Platform): string {
  let full = resolve(p);
  let rest = "";
  for (;;) {
    try {
      full = realpathSync.native(full) + rest;
      break;
    } catch {
      const parent = dirname(full);
      if (parent === full) {
        full = full + rest;
        break;
      }
      rest = sep + full.slice(parent.length).replace(/^[\\/]+/, "") + rest;
      full = parent;
    }
  }
  // macOS and Windows file systems are case-insensitive by default.
  return os === "linux" ? full : full.toLowerCase();
}

/** Throw if `profileDir` is, or is inside, a browser's main user-data folder. */
export function assertNotMainProfile(
  profileDir: string,
  os: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): void {
  const dir = canonical(profileDir, os);
  for (const main of mainProfileDirs(os, home, env)) {
    const m = canonical(main, os);
    if (dir === m || dir.startsWith(m + sep)) {
      throw new BlockingError(
        `LECLERC_CHROME_PROFILE_DIR pointe vers le profil principal de ton navigateur (${main}). ` +
          `Le serveur utilise toujours un profil dédié : retire cette variable (défaut ` +
          `~/.mcp-leclerc-drive/chrome) ou choisis un dossier vide à part.`,
      );
    }
  }
}

export function writeLock(profileDir: string, pid: number, port: number, browser: string): void {
  const lock: Lock = { pid, port, browser, startedAt: new Date().toISOString() };
  writeFileSync(join(profileDir, LOCK_FILE), JSON.stringify(lock) + "\n", "utf8");
}

function readLock(profileDir: string): Lock | null {
  try {
    const o = JSON.parse(readFileSync(join(profileDir, LOCK_FILE), "utf8"));
    if (Number.isInteger(o?.pid) && o.pid > 0 && Number.isInteger(o?.port) && typeof o?.browser === "string") {
      return o as Lock;
    }
  } catch {
    /* missing or unreadable */
  }
  return null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The port Chrome itself says it listens on for this profile, if any. */
function devToolsActivePort(profileDir: string): number | null {
  const file = join(profileDir, "DevToolsActivePort");
  if (!existsSync(file)) return null;
  const first = readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim();
  return first && /^\d+$/.test(first) ? Number(first) : null;
}

/**
 * Why a Chrome found listening on `port` (reporting `browser` as its DevTools
 * id) must not be used, or null if it is the one this server started on
 * `profileDir`.
 */
export function foreignChromeReason(profileDir: string, port: number, browser: string | null): string | null {
  const lock = readLock(profileDir);
  if (!lock) return "aucun verrou du serveur dans son profil";
  if (lock.port !== port) return `le verrou indique le port ${lock.port}`;
  if (!pidAlive(lock.pid)) return "le Chrome du verrou n'existe plus";
  if (!browser || browser !== lock.browser) return "ce n'est pas le Chrome du verrou";
  const active = devToolsActivePort(profileDir);
  if (active !== null && active !== port) return "ce Chrome n'utilise pas le profil du serveur";
  return null;
}
