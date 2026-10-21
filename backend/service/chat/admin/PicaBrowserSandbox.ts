import { realpath } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright-core";

import { PicaAdminError } from "./PicaAdminContracts";

import type { Browser } from "playwright-core";

/** Starts a private Chromium inside mandatory unprivileged mount/PID/network namespaces with no host home. */
export async function launchPicaBrowser(): Promise<Browser> {
  if (process.platform !== "linux" || process.getuid?.() === 0)
    throw new PicaAdminError("ISOLATION_UNAVAILABLE");
  const executable = await realpath(chromium.executablePath());
  const directory = path.dirname(executable);
  // Chromium's inner sandbox cannot nest on every host. The mandatory outer namespace supplies isolation,
  // drops all capabilities and provides no network interface or writable host mount. There is no fallback.
  return chromium.launch({
    executablePath: "/usr/bin/bwrap",
    ignoreDefaultArgs: true,
    timeout: 15_000,
    env: {},
    args: [
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--cap-drop",
      "ALL",
      "--clearenv",
      "--ro-bind",
      "/usr",
      "/usr",
      "--symlink",
      "usr/bin",
      "/bin",
      "--symlink",
      "usr/lib",
      "/lib",
      "--symlink",
      "usr/lib64",
      "/lib64",
      "--ro-bind",
      directory,
      "/browser",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--dir",
      "/etc",
      "--ro-bind",
      "/etc/fonts",
      "/etc/fonts",
      "--ro-bind",
      "/etc/ld.so.cache",
      "/etc/ld.so.cache",
      "--setenv",
      "HOME",
      "/tmp",
      "--setenv",
      "PATH",
      "/usr/bin",
      "--",
      `/browser/${path.basename(executable)}`,
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--user-data-dir=/tmp/profile",
      "--remote-debugging-pipe",
      "--no-startup-window",
    ],
  });
}
