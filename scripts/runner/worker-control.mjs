import { join } from "node:path";

import { readRecord, store } from "./journal.mjs";
import { pagesRequest } from "./pages.mjs";
import { cancellationFor, hasExecutionLease } from "./revocation.mjs";

function cancellationClock(privateRoot, job, controller) {
  let isCancelReadBusy = false;
  return setInterval(() => {
    if (isCancelReadBusy) return;
    isCancelReadBusy = true;
    void cancellationFor(privateRoot, job)
      .then(async (record) => {
        if (record || !(await hasExecutionLease(privateRoot, job, true)))
          controller.abort("cancelled");
      })
      .catch(() => controller.abort("cancelled"))
      .finally(() => {
        isCancelReadBusy = false;
      });
  }, 250);
}

function timeoutClock(folder, job, launch, controller) {
  const began = launch.startedAt ?? Date.now();
  let isReadingClock = false;
  return job.execution.timeoutSeconds === 0
    ? null
    : setInterval(() => {
        if (isReadingClock) return;
        isReadingClock = true;
        void readRecord(join(folder, "pause.json"))
          .then((paused) => {
            const now = Date.now();
            const excluded =
              (paused?.totalMilliseconds ?? 0) +
              (paused?.isPaused ? now - paused.startedAt : 0);
            if (now - began - excluded >= job.execution.timeoutSeconds * 1000)
              controller.abort("timeout");
          })
          .catch(() => controller.abort("cancelled"))
          .finally(() => {
            isReadingClock = false;
          });
      }, 100);
}

function pagesLease(privateRoot, job, controller) {
  let leaseBusy = false;
  return job.execution.pagesAccess === 1
    ? setInterval(() => {
        if (leaseBusy) return;
        leaseBusy = true;
        void pagesRequest(join(privateRoot, "pages.sock"), job.jobId, {
          kind: "lease",
        })
          .catch((error) => {
            if (error.code && error.code !== "pages_transport_unavailable")
              controller.abort("cancelled");
          })
          .finally(() => {
            leaseBusy = false;
          });
      }, 5000)
    : null;
}

function workerHeartbeat(folder, job, controller) {
  let pending = null;
  const timer = setInterval(() => {
    if (pending) return;
    pending = store(join(folder, "heartbeat.json"), {
      jobId: job.jobId,
      observedAt: Date.now(),
    })
      .catch(() => controller.abort("storage"))
      .finally(() => {
        pending = null;
      });
  }, 1000);
  return {
    async close() {
      clearInterval(timer);
      await pending;
    },
  };
}

/** Detects an unresponsive managed supervisor while preserving unlimited model turns and frozen workers. */
export function isWorkerStalled(input) {
  if (input.paused?.isPaused) return false;
  const heartbeat =
    input.heartbeat?.jobId === input.jobId &&
    Number.isFinite(input.heartbeat.observedAt)
      ? input.heartbeat.observedAt
      : 0;
  const thawedAt = Date.parse(input.paused?.observedAt ?? "") || 0;
  const last = Math.max(input.startedAt ?? input.now, heartbeat, thawedAt);
  return input.now - last > 120000;
}

/** Keeps revocation and deadlines outside output parsing; confirmed frozen time is excluded. */
export function workerControl(folder, job, launch) {
  const controller = new AbortController();
  const privateRoot = join(folder, "..", "..");
  const heartbeat = workerHeartbeat(folder, job, controller);
  const clocks = [
    cancellationClock(privateRoot, job, controller),
    timeoutClock(folder, job, launch, controller),
    pagesLease(privateRoot, job, controller),
  ];
  return {
    signal: controller.signal,
    abort(reason) {
      controller.abort(reason);
    },
    async close() {
      for (const clock of clocks) clearInterval(clock);
      await heartbeat.close();
    },
  };
}
