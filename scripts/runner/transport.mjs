// Pages protocol v1 with durable execution claims and detached workers.
import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import {
  claimJob,
  observeJob,
  cancelJob,
  interpreters,
  store,
} from "./execution.mjs";
import { githubAccess } from "./github.mjs";
import { cliInventory } from "./cli.mjs";
import { startPagesRelay } from "./pages.mjs";
import { liveBatch } from "./live.mjs";
import { RunnerSchedule } from "./schedule.mjs";
import { handleProvider } from "./provider.mjs";
import { sendRunnerPacket, MAXIMUM_RUNNER_PACKET_BYTES } from "./wire.mjs";

const RUNNER_VERSION = "1.9.0";
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
const jobSnapshots = new Map();
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
        reject(new Error("Pages channel unavailable"));
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
          reject(new Error("Pages channel timeout"));
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
const progressSnapshots = new Map();
let pendingSentAt = 0;
let lastPolledJobId = null;
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
async function persist() {
  await store(file, configuration);
}
function eventPacket(event) {
  const job = { ...event.job };
  delete job.execution;
  return { ...event, delta: true, job };
}
function observedStatus(job, observed) {
  if (job.status === "queued" && observed.launch) return "accepted";
  if (job.status === "accepted") return "running";
  return observed.status;
}
function pollingOrder() {
  const previous = configuration.jobs.findIndex(
    (job) => job.jobId === lastPolledJobId,
  );
  const jobs = [
    ...configuration.jobs.slice(previous + 1),
    ...configuration.jobs.slice(0, previous + 1),
  ];
  // Diagnostic backlogs must not block another job's dispatch or terminal result.
  return jobs.sort(
    (first, second) =>
      Number(completionNotices.has(second.jobId)) -
      Number(completionNotices.has(first.jobId)),
  );
}
async function pollJobs(channel) {
  if (channel.readyState !== WebSocket.OPEN) return;
  if (configuration.pending) {
    sendRunnerPacket(channel, eventPacket(configuration.pending));
    pendingSentAt = Date.now();
    return;
  }
  for (const job of pollingOrder()) {
    if (completionNotices.delete(job.jobId)) {
      schedule.checked.delete(job.jobId);
      jobSnapshots.delete(job.jobId);
    }
    const isTerminal = ["completed", "failed", "interrupted", "lost"].includes(
      job.status,
    );
    if (isTerminal && (job.historyCursor ?? 0) >= (job.historyLength ?? 0))
      continue;
    if (!jobSnapshots.has(job.jobId) && !schedule.isDue(job)) continue;
    if (job.status === "queued") await claimJob(directory, job);
    let snapshot =
      job.outputJournalVersion === 2 ? null : jobSnapshots.get(job.jobId);
    if (!snapshot) {
      const checkedAt = Date.now();
      snapshot = { observed: await observeJob(directory, job), checkedAt };
    }
    const { observed, checkedAt } = snapshot;
    if (!observed) {
      schedule.polled(job, checkedAt);
      continue;
    }
    const history = liveBatch(observed.history, job.historyCursor ?? 0);
    const status = observedStatus(job, observed);
    if (
      status === "running" &&
      job.status === "running" &&
      !history.length &&
      progressSnapshots.get(job.jobId) === JSON.stringify(observed.result)
    ) {
      schedule.polled(job, checkedAt);
      continue;
    }
    const hasMoreHistory =
      (observed.historyLength ?? observed.history?.at(-1)?.sequence ?? 0) >
      (history.at(-1)?.sequence ?? job.historyCursor ?? 0);
    const updated = {
      ...job,
      status,
      ...(job.liveHistoryVersion === 1
        ? { historyCursor: history.at(-1)?.sequence ?? job.historyCursor ?? 0 }
        : {}),
      ...(observed.launch ? { launch: observed.launch } : {}),
      ...(observed.historyFailure
        ? { historyFailure: observed.historyFailure }
        : {}),
      ...(job.liveHistoryVersion === 1 &&
      ["completed", "failed", "interrupted", "lost"].includes(status)
        ? {
            historyLength:
              observed.historyLength ?? observed.history?.at(-1)?.sequence ?? 0,
          }
        : {}),
    };
    const event = {
      version: 1,
      type: "event",
      sessionId: configuration.sessionId,
      eventId: randomUUID(),
      sequence: configuration.sequence + 1,
      job: updated,
      ...(history.length ? { history } : {}),
      ...(isTerminal ||
      (["queued", "accepted"].includes(job.status) && status !== "lost")
        ? {}
        : {
            result: observed.result,
          }),
    };
    // Drain this snapshot alone. New CLI output waits for the next cadence, even while acknowledgements arrive.
    if (
      hasMoreHistory ||
      updated.status === "accepted" ||
      (updated.status === "running" && observed.status !== "running")
    )
      jobSnapshots.set(job.jobId, snapshot);
    else {
      jobSnapshots.delete(job.jobId);
      schedule.polled(job, checkedAt);
    }
    progressSnapshots.set(job.jobId, JSON.stringify(observed.result));
    lastPolledJobId = job.jobId;
    configuration.pending = event;
    await persist();
    sendRunnerPacket(channel, eventPacket(event));
    pendingSentAt = Date.now();
    return;
  }
}
async function receiveJob(message) {
  if (message.type === "dispatch") {
    const previous = configuration.jobs.find(
      (entry) => entry.jobId === message.job.jobId,
    );
    if (!previous) {
      configuration.jobs.push(message.job);
      await persist();
    }
    if ((!previous || previous.status === "queued") && !configuration.pending)
      await claimJob(directory, message.job);
  } else if (message.type === "cancel")
    await cancelJob(directory, message.jobId);
  else if (
    message.type === "ack" &&
    configuration.pending?.eventId === message.eventId
  ) {
    configuration.sequence = message.sequence;
    configuration.jobs = configuration.jobs.map((job) =>
      job.jobId === configuration.pending.job.jobId
        ? configuration.pending.job
        : job,
    );
    configuration.pending = null;
    await persist();
  }
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
    interpreters: await interpreters(),
    tools: await toolInventory(),
  });
}

async function receiveReconciliation(message) {
  if (message.outputJournalVersion !== 2)
    throw new UnrecoverableError(
      "Pages does not support Runner 1.9.0 chunk journals; upgrade Pages explicitly.",
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
  jobSnapshots.clear();
  await persist();
  attempts = 0;
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

function pollingDelay() {
  if (configuration.pending) {
    const job =
      configuration.jobs.find(
        (entry) => entry.jobId === configuration.pending.job.jobId,
      ) ?? configuration.pending.job;
    return Math.max(0, pendingSentAt + schedule.interval(job) - Date.now());
  }
  if (completionNotices.size) return 0;
  return schedule.delay(configuration.jobs);
}

function createJobPolling(channel, state, enqueue) {
  const poll = () => {
    clearTimeout(state.poll);
    if (!state.isReconciled || channel.readyState !== WebSocket.OPEN) return;
    state.poll = setTimeout(() => {
      enqueue(async () => {
        await pollJobs(channel);
        poll();
      });
    }, pollingDelay());
  };
  return poll;
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
    };
    const timeout = setTimeout(() => channel.close(), 15000);
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
      state.deadline = setTimeout(() => channel.close(), 45000);
    };
    const poll = createJobPolling(channel, state, enqueue);
    requestJobPoll = poll;
    channel.addEventListener("error", () => channel.close());
    channel.addEventListener("message", (event) =>
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
          ready(channel.readyState === WebSocket.OPEN ? channel : null);
          clearTimeout(timeout);
          poll();
          state.heartbeat = startHeartbeat(channel);
          deadline();
          return;
        }
        if (!state.isReconciled) throw new Error("Reconciliation required");
        if (message.type === "pages-result") {
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
          await receiveJob(message);
          poll();
        }
      }),
    );
    channel.addEventListener("close", () => {
      ready(null);
      state.isReconciled = false;
      clearTimeout(timeout);
      clearInterval(state.heartbeat);
      clearTimeout(state.poll);
      clearTimeout(state.deadline);
      for (const pending of pagesRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Pages channel closed"));
      }
      pagesRequests.clear();
      void state.chain.then(resolve, resolve);
    });
  });
}
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
await stopPagesRelay();
if (unrecoverable) exitUnrecoverable(unrecoverable.message);
