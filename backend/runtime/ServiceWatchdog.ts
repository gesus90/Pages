import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";

import { isProcessStopping, registerShutdownTask } from "./ProcessLifecycle";

const execute = promisify(execFile);

/** Arms systemd only after real readiness; a failed or stuck probe never renews the watchdog. */
export function startServiceWatchdog(probe: () => Promise<boolean>): void {
  if (!process.env.NOTIFY_SOCKET) return;
  const watchdogUsec = Number(process.env.WATCHDOG_USEC);
  const intervalMs =
    Number.isFinite(watchdogUsec) && watchdogUsec > 0
      ? Math.max(100, Math.min(10_000, watchdogUsec / 3000))
      : 10_000;
  let isReady = false;
  let isProbing = false;
  const tick = async (): Promise<void> => {
    if (isProbing || isProcessStopping()) return;
    isProbing = true;
    try {
      const canWork = await withBackgroundDatabaseWork(
        "service_watchdog",
        probe,
      );
      if (!canWork || isProcessStopping()) return;
      const notification = [`--pid=${process.pid}`, "WATCHDOG=1"];
      if (!isReady) notification.push("--ready");
      await execute("/usr/bin/systemd-notify", notification, { timeout: 3000 });
      isReady = true;
    } catch (error: unknown) {
      logCaughtError("ServiceWatchdog", error);
    } finally {
      isProbing = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  registerShutdownTask(
    async () => {
      clearInterval(timer);
    },
    { step: "service_watchdog" },
  );
  void tick();
}
