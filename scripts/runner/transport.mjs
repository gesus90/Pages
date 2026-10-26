// Pages protocol v1 with durable execution claims and detached workers.
import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { renewExecutionLease, hasExecutionLease } from "./revocation.mjs";
import { readRecord } from "./journal.mjs";
import { cancelJob, interpreterCatalog, store } from "./execution.mjs";
import { githubAccess } from "./github.mjs";
import { cliInventory } from "./cli.mjs";
import { startPagesRelay } from "./pages.mjs";
import { RunnerJobs } from "./jobs.mjs";
import { RunnerSchedule } from "./schedule.mjs";
import { handleProvider } from "./provider.mjs";
import { sendRunnerPacket, MAXIMUM_RUNNER_PACKET_BYTES } from "./wire.mjs";

const RUNNER_VERSION = "1.11.0";
if (process.argv.includes("--version")) {
  console.info(`pages-runner ${RUNNER_VERSION}`);
  process.exit(0);
}
// systemd must not restart a runner whose configuration or counterpart is wrong (RestartPreventExitStatus=78).
const EXIT_UNRECOVERABLE = 78;
const MAXIMUM_BACKOFF_MILLISECONDS = 60000;

/** A condition no reconnect can repair: the configuration, or a counterpart that is not our Pages. */
class UnrecoverableError extends Error {}

function exitUnrecoverable(message) {
  console.error(`pages-runner: ${message}`);
  process.exit(EXIT_UNRECOVERABLE);
}
const directory =
  process.env.PAGES_RUNNER_DIRECTORY ??
  join(homedir(), ".config", "pages-runner");
if (!directory.startsWith("/") || directory.includes("\0"))
  throw new Error("Runner directory must be absolute");
const file = join(directory, "config.json");
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await lstat(directory)).isSymbolicLink())
  throw new Error("Runner storage must not be a symbolic link");
await chmod(directory, 0o700);

const INVENTORY_MAXIMUM_AGE_MILLISECONDS = 600000;
// Half of Pages' ten-minute catalog age, so one lost refresh never makes a connected runner stale.
const CATALOG_REFRESH_MILLISECONDS = 300000;
let inventory = { checkedAt: 0, tools: [] };

/** What the tools themselves report; a version they do not print stays unknown. */
async function toolInventory() {
  if (Date.now() - inventory.checkedAt < INVENTORY_MAXIMUM_AGE_MILLISECONDS)
    return inventory.tools;
  const tools = await cliInventory();
  inventory = { checkedAt: Date.now(), tools };
  return tools;
}

let configuration;
try {
  configuration = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error instanceof SyntaxError)
    exitUnrecoverable("Runner configuration is not valid JSON.");
  if (error.code !== "ENOENT")
    throw new Error("Runner configuration unreadable");
}
if (!configuration) {
  // A service has no terminal; pairing hands the configuration over before the first start.
  if (!process.stdin.isTTY)
    exitUnrecoverable("Not paired: no configuration and no terminal.");
  let isHidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!isHidden) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const endpoint = await terminal.question(
    "Pages WS/WSS-URL (/runner/v1/channel/CONNECTION-ID): ",
  );
  process.stdout.write(
    "Kurzlebige Registrierungsfreigabe (verdeckte Eingabe): ",
  );
  isHidden = true;
  const token = await terminal.question("");
  isHidden = false;
  process.stdout.write("\n");
  terminal.close();
  configuration = { endpoint, token, sessionId: null, sequence: 0, jobs: [] };
}
let endpoint;
try {
  endpoint = new URL(configuration.endpoint);
} catch {
  exitUnrecoverable("Invalid runner endpoint.");
}
if (
  !["ws:", "wss:"].includes(endpoint.protocol) ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash ||
  !/^\/runner\/v1\/channel\/[a-f0-9-]{36}$/.test(endpoint.pathname) ||
  !/^[A-Za-z0-9_-]{43}$/.test(configuration.token)
) {
  exitUnrecoverable("Invalid runner endpoint or credential.");
}
const connectionId = endpoint.pathname.split("/").pop();
let attempts = 0;
let unrecoverable = null;
let stopped = false;
let socket;
let reconciliation = Promise.resolve(null);
let requestJobPoll = null;
const schedule = new RunnerSchedule();
const completionNotices = new Set();
const pagesRequests = new Map();
const stopPagesRelay = await startPagesRelay(
  directory,
  async (jobId, request) => {
    if (request.kind === "job-completed") {
      const job = configuration.jobs.find((entry) => entry.jobId === jobId);
      if (!job?.plan) throw new Error("Unknown runner completion notice");
      completionNotices.add(jobId);
      requestJobPoll?.();
      return { notified: true };
    }
    const startedAt = Date.now();
    const channel = await reconciliation;
    return new Promise((resolve, reject) => {
      if (
        !channel ||
        socket !== channel ||
        channel.readyState !== WebSocket.OPEN ||
        pagesRequests.size >= 32 ||
        Date.now() - startedAt >= 20000
      ) {
        reject(
          Object.assign(new Error("Pages channel unavailable"), {
            code: "pages_transport_unavailable",
          }),
        );
        return;
      }
      const job = configuration.jobs.find((entry) => entry.jobId === jobId);
      if (
        job?.execution?.pagesAccess !== 1 ||
        ["completed", "failed", "interrupted", "lost"].includes(job.status)
      ) {
        reject(new Error("Pages job unavailable"));
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(
        () => {
          pagesRequests.delete(requestId);
          reject(
            Object.assign(new Error("Pages channel timeout"), {
              code: "pages_transport_unavailable",
            }),
          );
        },
        Math.max(1, 20000 - (Date.now() - startedAt)),
      );
      pagesRequests.set(requestId, { resolve, reject, timer });
      sendRunnerPacket(channel, {
        version: 1,
        type: "pages-request",
        requestId,
        jobId,
        request,
      });
    });
  },
);
let isProviderBusy = false;
let isGitHubBusy = false;
const jobs = new RunnerJobs({
  configuration,
  directory,
  persist,
  schedule,
  completionNotices,
});
let wake = null;
// A stop signal ends the wait between reconnects at once instead of after up to a minute.
const sleep = (milliseconds) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
let persistence = Promise.resolve();
async function persist() {
  const snapshot = structuredClone(configuration);
  persistence = persistence
    .catch(() =>
      console.error("Runner journal write retry after a failed checkpoint."),
    )
    .then(() => store(file, snapshot));
  await persistence;
}
/** The counterpart must be the Pages that registered this runner, not whatever answers at the address. */
function requireKnownCounterpart(message) {
  if (message.connectionId !== connectionId)
    throw new UnrecoverableError("Counterpart names another connection.");
  if (configuration.runnerId && configuration.runnerId !== message.runnerId)
    throw new UnrecoverableError("Counterpart names another runner identity.");
  if (configuration.sessionId && configuration.sessionId !== message.sessionId)
    throw new UnrecoverableError("Counterpart names another runner session.");
}

async function currentCatalog(refreshTools = false) {
  const probe = await interpreterCatalog();
  const tools = refreshTools ? await toolInventory() : inventory.tools;
  const catalog = {
    generation: (configuration.catalog?.generation ?? 0) + 1,
    checkedAt: new Date().toISOString(),
    isComplete: probe.isComplete,
    // The last completed probe stays authoritative; the worker rechecks login and model at start.
    areToolsComplete: inventory.checkedAt > 0,
    interpreters: probe.interpreters,
    tools,
    removedInterpreterIds: [],
  };
  configuration.catalog = catalog;
  await persist();
  return catalog;
}

async function receiveRegistration(message, channel) {
  requireKnownCounterpart(message);
  if (message.token) configuration.token = message.token;
  configuration.runnerId = message.runnerId;
  configuration.sessionId = message.sessionId;
  await persist();
  if (channel.readyState !== WebSocket.OPEN) return;
  sendRunnerPacket(channel, {
    version: 1,
    type: "reconcile",
    sessionId: configuration.sessionId,
    sequence: configuration.sequence,
    jobs: configuration.jobs,
    executorVersion: 1,
    cliExecutorVersion: 1,
    githubAccessVersion: 1,
    pagesAccessVersion: 1,
    openCodeExecutorVersion: 1,
    liveHistoryVersion: 1,
    outputJournalVersion: 2,
    communicationVersion: 1,
    executionLeaseVersion: 1,
    runnerVersion: RUNNER_VERSION,
    catalog: await currentCatalog(),
    interpreters: configuration.catalog.interpreters,
    tools: configuration.catalog.tools,
  });
}

async function receiveReconciliation(message) {
  if (message.outputJournalVersion !== 2 || message.communicationVersion !== 1)
    throw new UnrecoverableError(
      "Pages does not support Runner 1.10 communication; upgrade Pages explicitly.",
    );
  if (message.state.sessionId !== configuration.sessionId)
    throw new UnrecoverableError("Counterpart reconciled another session.");
  if (
    configuration.pending &&
    configuration.pending.sequence <= message.state.sequence
  )
    configuration.pending = null;
  configuration.sequence = message.state.sequence;
  configuration.jobs = message.state.jobs;
  // A restored configuration must not number its inventories below what Pages already holds.
  const knownGeneration = message.state.catalog?.generation ?? 0;
  if (
    configuration.catalog &&
    configuration.catalog.generation < knownGeneration
  )
    configuration.catalog = {
      ...configuration.catalog,
      generation: knownGeneration,
    };
  jobs.clear();
  await Promise.all(
    configuration.jobs
      .filter((job) => job.cancellation)
      .map((job) => cancelJob(directory, job)),
  );
  await fenceExpiredJobs();
  await persist();
  await renewExecutionLease(directory, configuration.sessionId);
  attempts = 0;
}

async function sendStopResult(channel, job) {
  const cancellation = await readRecord(
    join(directory, "jobs", job.jobId, "stop.json"),
  );
  if (
    channel.readyState === WebSocket.OPEN &&
    cancellation?.requestedAt === job.cancellation?.requestedAt
  )
    sendRunnerPacket(channel, {
      version: 1,
      type: "stop-result",
      sessionId: job.sessionId,
      jobId: job.jobId,
      attemptId: job.plan.attemptId,
      cancellation,
    });
}

function receiveProvider(message, channel) {
  if (isProviderBusy || !/^[a-f0-9-]{36}$/.test(message.requestId))
    throw new Error("Invalid provider command");
  isProviderBusy = true;
  void handleProvider(message, channel, directory)
    .catch(() => channel.close())
    .finally(() => {
      isProviderBusy = false;
    });
}

function receiveGitHub(message, channel) {
  if (isGitHubBusy) throw new Error("GitHub probe already running");
  isGitHubBusy = true;
  void githubAccess(message)
    .then((reply) => {
      if (channel.readyState === WebSocket.OPEN)
        sendRunnerPacket(channel, reply);
    })
    .catch(() => channel.close())
    .finally(() => {
      isGitHubBusy = false;
    });
}

function receivePagesResult(message) {
  const pending = pagesRequests.get(message.requestId);
  if (pending) {
    pagesRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else {
      const failure = new Error("Pages access refused");
      failure.code = message.error;
      pending.reject(failure);
    }
  }
}

function createJobPolling(channel, state, enqueue) {
  const poll = () => {
    clearTimeout(state.poll);
    if (!state.isReconciled || channel.readyState !== WebSocket.OPEN) return;
    state.poll = setTimeout(() => {
      enqueue(async () => {
        await jobs.poll(channel);
        poll();
      });
    }, jobs.delay());
  };
  return poll;
}

/** Interpreters are rechecked periodically; CLI tools only after registration or an explicit refresh. */
function createCatalogRefresh(channel, state) {
  return (refreshTools) => {
    if (
      state.isCatalogBusy ||
      socket !== channel ||
      channel.readyState !== WebSocket.OPEN
    )
      return;
    state.isCatalogBusy = true;
    void currentCatalog(refreshTools)
      .then((catalog) => {
        if (socket === channel && channel.readyState === WebSocket.OPEN)
          sendRunnerPacket(channel, {
            version: 1,
            type: "catalog",
            sessionId: configuration.sessionId,
            catalog,
          });
      })
      .catch(() => channel.close())
      .finally(() => {
        state.isCatalogBusy = false;
      });
  };
}

function startHeartbeat(channel) {
  return setInterval(() => {
    if (channel.readyState !== WebSocket.OPEN) return;
    try {
      sendRunnerPacket(channel, {
        version: 1,
        type: "heartbeat",
        sessionId: configuration.sessionId,
      });
    } catch {
      console.error("Runner heartbeat transport blocked; reconciling.");
      channel.close();
    }
  }, 15000);
}

function closeChannel(channel) {
  channel.close();
}

async function connect() {
  await new Promise((resolve) => {
    let ready;
    reconciliation = new Promise((settled) => {
      ready = settled;
    });
    socket = new WebSocket(endpoint, [
      "pages-runner.v1",
      `credential.${configuration.token}`,
    ]);
    const channel = socket;
    const state = {
      isReconciled: false,
      chain: Promise.resolve(),
      pendingMessages: 0,
      heartbeat: null,
      deadline: null,
      poll: null,
      catalogTimer: null,
      isCatalogBusy: false,
    };
    const timeout = setTimeout(() => closeChannel(channel), 15000);
    const enqueue = (work) => {
      if (state.pendingMessages >= 32) {
        console.error(
          "Runner receive queue full; reconciling from confirmed positions.",
        );
        channel.close();
        return;
      }
      state.pendingMessages += 1;
      state.chain = state.chain
        .then(async () => {
          if (channel.readyState === WebSocket.OPEN) await work();
        })
        .catch((error) => {
          if (error instanceof UnrecoverableError) unrecoverable = error;
          else {
            const detail =
              /^(?:Output journal|Private runner|Runner |Pages channel|Invalid |Unsupported )/u.test(
                error.message ?? "",
              )
                ? error.message
                : (error.code ?? error.name ?? "unknown");
            const location =
              error.stack?.split("\n")[1]?.trim() ?? "unknown location";
            console.error(
              `Runner protocol failed; reconciliation required (${detail}; ${location}).`,
            );
          }
          channel.close();
        })
        .finally(() => {
          state.pendingMessages -= 1;
        });
    };
    const deadline = () => {
      clearTimeout(state.deadline);
      state.deadline = setTimeout(() => closeChannel(channel), 45000);
    };
    const poll = createJobPolling(channel, state, enqueue);
    requestJobPoll = poll;
    channel.addEventListener("error", () => channel.close());
    channel.addEventListener("message", (event) => {
      let control;
      try {
        if (
          typeof event.data !== "string" ||
          Buffer.byteLength(event.data) > MAXIMUM_RUNNER_PACKET_BYTES
        )
          throw new Error("Runner message exceeds wire budget");
        control = JSON.parse(event.data);
        if (control.version !== 1)
          throw new UnrecoverableError("Unsupported protocol version.");
      } catch (error) {
        if (error instanceof UnrecoverableError) unrecoverable = error;
        channel.close();
        return;
      }
      if (socket !== channel || channel.readyState !== WebSocket.OPEN) return;
      if (
        state.isReconciled &&
        control.type === "heartbeat" &&
        control.sessionId === configuration.sessionId
      ) {
        void renewExecutionLease(directory, configuration.sessionId).catch(() =>
          channel.close(),
        );
        deadline();
        return;
      }
      if (state.isReconciled && control.type === "cancel") {
        const job = configuration.jobs.find(
          (entry) => entry.jobId === control.jobId,
        );
        if (
          !job ||
          control.sessionId !== job.sessionId ||
          control.attemptId !== job.plan?.attemptId ||
          !control.requestedAt ||
          !Number.isFinite(Date.parse(control.requestedAt))
        ) {
          channel.close();
          return;
        }
        void cancelJob(directory, {
          ...job,
          cancellation: { requestedAt: control.requestedAt },
        })
          .then(async () => {
            await sendStopResult(channel, {
              ...job,
              cancellation: { requestedAt: control.requestedAt },
            });
            schedule.checked.delete(job.jobId);
            completionNotices.add(job.jobId);
            poll();
          })
          .catch(() => channel.close());
        return;
      }
      enqueue(async () => {
        if (
          typeof event.data !== "string" ||
          Buffer.byteLength(event.data) > MAXIMUM_RUNNER_PACKET_BYTES
        )
          throw new Error("Runner message exceeds 2 MiB wire budget");
        const message = JSON.parse(event.data);
        if (message.version !== 1)
          throw new UnrecoverableError("Unsupported protocol version.");
        if (message.type === "registered") {
          await receiveRegistration(message, channel);
          return;
        }
        if (message.type === "reconcile") {
          await receiveReconciliation(message);
          if (channel.readyState !== WebSocket.OPEN) return;
          state.isReconciled = true;
          for (const job of configuration.jobs)
            if (job.cancellation) await sendStopResult(channel, job);
          ready(channel.readyState === WebSocket.OPEN ? channel : null);
          clearTimeout(timeout);
          poll();
          state.heartbeat = startHeartbeat(channel);
          const refreshCatalog = createCatalogRefresh(channel, state);
          refreshCatalog(true);
          state.catalogTimer = setInterval(
            () => refreshCatalog(false),
            CATALOG_REFRESH_MILLISECONDS,
          );
          deadline();
          return;
        }
        if (!state.isReconciled) throw new Error("Reconciliation required");
        if (message.type === "catalog-ack") {
          if (message.sessionId !== configuration.sessionId)
            throw new Error("Runner catalog session mismatch");
        } else if (message.type === "pages-result") {
          receivePagesResult(message);
        } else if (message.type === "observation") {
          schedule.observe(message, configuration.jobs);
          poll();
        } else if (message.type === "heartbeat") deadline();
        else if (message.type === "refresh-tools") {
          inventory.checkedAt = 0;
          channel.close();
        } else if (message.type === "openrouter")
          receiveProvider(message, channel);
        else if (message.type === "github-access")
          receiveGitHub(message, channel);
        else {
          await jobs.receive(message);
          poll();
        }
      });
    });
    channel.addEventListener("close", () => {
      ready(null);
      state.isReconciled = false;
      clearTimeout(timeout);
      clearInterval(state.heartbeat);
      clearTimeout(state.poll);
      clearTimeout(state.deadline);
      clearInterval(state.catalogTimer);
      for (const pending of pagesRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          Object.assign(new Error("Pages channel closed"), {
            code: "pages_transport_unavailable",
          }),
        );
      }
      pagesRequests.clear();
      void state.chain.then(resolve, resolve);
    });
  });
}
let isFenceBusy = false;
async function fenceExpiredJobs() {
  const active = configuration.jobs.filter(
    (job) =>
      job.plan &&
      job.execution &&
      ["queued", "accepted", "running"].includes(job.status),
  );
  const expired = [];
  for (const job of active) {
    if (!(await hasExecutionLease(directory, job))) expired.push(job);
  }
  const launched = new Set();
  for (const job of expired)
    if (await readRecord(join(directory, "jobs", job.jobId, "launch.json")))
      launched.add(job.jobId);
  const revoke = async (job) => {
    await cancelJob(directory, {
      ...job,
      cancellation: job.cancellation ?? {
        requestedAt: new Date().toISOString(),
      },
    });
  };
  // The host admits at most four workers. Fence them together before walking
  // a potentially much longer queue that has no execution to keep alive.
  await Promise.all(
    expired.filter((job) => launched.has(job.jobId)).map(revoke),
  );
  for (const job of expired) if (!launched.has(job.jobId)) await revoke(job);
}
const fenceTimer = setInterval(() => {
  if (isFenceBusy) return;
  isFenceBusy = true;
  void fenceExpiredJobs()
    .catch(() =>
      console.error("Runner execution fencing failed; cleanup unconfirmed."),
    )
    .finally(() => {
      isFenceBusy = false;
    });
}, 1000);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
    socket?.close();
    wake?.();
  });
/** Exponential, capped at one minute, with jitter so many runners do not return together. */
function backoffMilliseconds(failures) {
  const base = Math.min(
    MAXIMUM_BACKOFF_MILLISECONDS,
    1000 * 2 ** Math.min(failures, 6),
  );
  return base + Math.floor(Math.random() * 1000);
}

// The channel is permanent: a lost connection, an unreachable or restarting Pages and a
// refused credential are all retried with a bounded backoff, never a stop. Only a
// counterpart that is not our Pages ends the process, with a status systemd does not restart.
while (!stopped && !unrecoverable) {
  try {
    await connect();
  } catch {
    console.error("pages-runner: connection unavailable.");
  }
  if (stopped || unrecoverable) break;
  attempts += 1;
  const delay = backoffMilliseconds(attempts);
  console.error(
    `pages-runner: disconnected; reconnecting in ${Math.round(delay / 1000)} s.`,
  );
  await sleep(delay);
}
clearInterval(fenceTimer);
await stopPagesRelay();
if (unrecoverable) exitUnrecoverable(unrecoverable.message);
