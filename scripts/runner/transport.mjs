// Pages protocol v1 with durable execution claims and detached workers.
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
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

const RUNNER_VERSION = "1.6.0";
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
const directory = join(homedir(), ".config", "pages-runner");
const file = join(directory, "config.json");
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await lstat(directory)).isSymbolicLink())
  throw new Error("Runner storage must not be a symbolic link");
await chmod(directory, 0o700);

/** Replaces private storage atomically without following a destination symlink. */
async function storePrivate(destination, contents) {
  const temporary = await mkdtemp(join(directory, ".private-"));
  try {
    const pending = join(temporary, "contents");
    await writeFile(pending, JSON.stringify(contents), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(pending, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Calls only the fixed provider origin; upstream bodies never become diagnostics. */
async function providerRequest(path, apiKey, body) {
  const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const failure = new Error("OpenRouter request failed");
    failure.upstreamStatus = response.status;
    throw failure;
  }
  return response;
}

/** A figure the provider stated as a finite, non-negative number; anything else stays unknown. */
function statedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Key usage as the provider states it; a field it omits stays unknown, never zero. */
function keyUsage(body) {
  const data = body?.data;
  return {
    used: statedNumber(data?.usage),
    limit: statedNumber(data?.limit),
    remaining: statedNumber(data?.limit_remaining),
    resets: ["daily", "weekly", "monthly"].includes(data?.limit_reset)
      ? data.limit_reset
      : null,
  };
}

/** Validates authentication separately because the public model catalog cannot prove it. */
async function checkProviderKey(apiKey) {
  const response = await providerRequest("key", apiKey);
  try {
    return keyUsage(await response.json());
  } catch {
    return keyUsage(null);
  }
}

/** Keeps only catalog metadata and identifies free prompt and completion prices explicitly. */
function catalogModel(model, apiKey) {
  if (
    typeof model?.id !== "string" ||
    !/^[a-zA-Z0-9/~_.:+-]{1,200}$/.test(model.id) ||
    typeof model.name !== "string" ||
    model.name.length > 300 ||
    model.name.includes(apiKey) ||
    model.id.includes(apiKey)
  )
    throw new Error("Invalid OpenRouter catalog");
  const limit = (figure) =>
    Number.isSafeInteger(figure) && figure > 0 ? figure : null;
  const prices = [model.pricing?.prompt, model.pricing?.completion];
  const isFree = prices.every(
    (price) =>
      typeof price === "string" && price.trim() !== "" && Number(price) === 0,
  );
  return {
    id: model.id,
    name: model.name,
    isFree,
    contextLength: limit(model.context_length),
    maxOutputTokens: limit(model.top_provider?.max_completion_tokens),
  };
}

/** The catalog entry Pages receives; limits the provider did not state are unknown. */
function listedModel(model) {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.contextLength ?? null,
    maxOutputTokens: model.maxOutputTokens ?? null,
  };
}

/** Validates a new key and catalog before replacing the previous provider configuration. */
async function syncProvider(apiKey) {
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{16,512}$/.test(apiKey))
    throw new Error("Invalid provider credential");
  const usage = await checkProviderKey(apiKey);
  const response = await providerRequest("models", apiKey);
  const catalog = await response.json();
  if (!Array.isArray(catalog?.data) || catalog.data.length > 10000)
    throw new Error("Invalid OpenRouter catalog");
  const models = catalog.data.map((model) => catalogModel(model, apiKey));
  const syncedAt = new Date().toISOString();
  const freeModels = models.filter((model) => model.isFree).map(listedModel);
  if (freeModels.length > 1000) throw new Error("Invalid OpenRouter catalog");
  await storePrivate(join(directory, "openrouter.json"), {
    apiKey,
    models,
    syncedAt,
  });
  return {
    operation: "sync",
    ok: true,
    keyStatus: 200,
    totalModels: models.length,
    freeModels,
    syncedAt,
    usage,
  };
}

/** Checks the stored credential and sends a bounded prompt using a synchronized free model. */
async function checkProvider(model) {
  const stored = JSON.parse(
    await readFile(join(directory, "openrouter.json"), "utf8"),
  );
  if (!stored.models.some((entry) => entry.id === model && entry.isFree))
    throw new Error("Synchronized free model required");
  const usage = await checkProviderKey(stored.apiKey);
  const response = await providerRequest("chat/completions", stored.apiKey, {
    model,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    max_tokens: 64,
  });
  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  return {
    operation: "check",
    ok: true,
    keyStatus: 200,
    chatStatus: 200,
    model,
    hasReply: typeof content === "string" && content.trim().length > 0,
    isOkReply: typeof content === "string" && content.trim() === "OK",
    usage,
  };
}

/** Returns allowlisted status fields only, including on provider or storage failures. */
async function handleProvider(message, channel) {
  let result;
  try {
    if (message.operation === "sync") {
      const apiKey =
        message.apiKey ??
        JSON.parse(await readFile(join(directory, "openrouter.json"), "utf8"))
          .apiKey;
      result = await syncProvider(apiKey);
    } else if (message.operation === "check")
      result = await checkProvider(message.model);
    else if (message.operation === "catalog") {
      const stored = JSON.parse(
        await readFile(join(directory, "openrouter.json"), "utf8"),
      );
      result = {
        operation: "catalog",
        ok: true,
        syncedAt: stored.syncedAt,
        freeModels: stored.models
          .filter((entry) => entry.isFree)
          .map(listedModel),
      };
    } else throw new Error("Unsupported provider operation");
  } catch (error) {
    result = {
      operation: "failed",
      ok: false,
      upstreamStatus: Number.isInteger(error.upstreamStatus)
        ? error.upstreamStatus
        : null,
    };
  }
  if (channel.readyState === WebSocket.OPEN)
    channel.send(
      JSON.stringify({
        version: 1,
        type: "openrouter-result",
        requestId: message.requestId,
        result,
      }),
    );
}
const INVENTORY_TOOLS = ["opencode"];
const INVENTORY_MAXIMUM_AGE_MILLISECONDS = 600000;
let inventory = { checkedAt: 0, tools: [] };

/** `undefined` when the tool is not installed; `null` when it is, but did not report a version. */
function toolVersion(tool) {
  return new Promise((resolve) => {
    execFile(
      tool,
      ["--version"],
      { timeout: 5000, maxBuffer: 16384, windowsHide: true },
      (error, stdout) => {
        if (error?.code === "ENOENT") resolve(undefined);
        else
          resolve(
            /\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,30}/.exec(stdout ?? "")?.[0] ?? null,
          );
      },
    );
  });
}

/** What the tools themselves report; a version they do not print stays unknown. */
async function toolInventory() {
  if (Date.now() - inventory.checkedAt < INVENTORY_MAXIMUM_AGE_MILLISECONDS)
    return inventory.tools;
  const tools = await cliInventory();
  for (const tool of INVENTORY_TOOLS) {
    const version = await toolVersion(tool);
    if (version !== undefined) tools.push({ tool, version });
  }
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
const pagesRequests = new Map();
const stopPagesRelay = await startPagesRelay(
  directory,
  (jobId, request) =>
    new Promise((resolve, reject) => {
      if (socket?.readyState !== WebSocket.OPEN || pagesRequests.size >= 32) {
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
      const timer = setTimeout(() => {
        pagesRequests.delete(requestId);
        reject(new Error("Pages channel timeout"));
      }, 20000);
      pagesRequests.set(requestId, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          version: 1,
          type: "pages-request",
          requestId,
          jobId,
          request,
        }),
      );
    }),
);
let isProviderBusy = false;
let isGitHubBusy = false;
const progressSnapshots = new Map();
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
function observedStatus(job, observed) {
  if (job.status === "queued" && observed.launch) return "accepted";
  if (job.status === "accepted") return "running";
  return observed.status;
}
async function pollJobs(channel) {
  if (channel.readyState !== WebSocket.OPEN) return;
  if (configuration.pending) {
    channel.send(JSON.stringify(configuration.pending));
    return;
  }
  for (const job of configuration.jobs) {
    if (["completed", "failed", "interrupted", "lost"].includes(job.status))
      continue;
    if (job.status === "queued") await claimJob(directory, job);
    const observed = await observeJob(directory, job);
    if (!observed) continue;
    const status = observedStatus(job, observed);
    if (
      status === "running" &&
      job.status === "running" &&
      progressSnapshots.get(job.jobId) === JSON.stringify(observed.result)
    )
      continue;
    const updated = {
      ...job,
      status,
      ...(observed.launch ? { launch: observed.launch } : {}),
    };
    const event = {
      version: 1,
      type: "event",
      sessionId: configuration.sessionId,
      eventId: randomUUID(),
      sequence: configuration.sequence + 1,
      job: updated,
      ...(["queued", "accepted"].includes(job.status) && status !== "lost"
        ? {}
        : { result: observed.result }),
    };
    progressSnapshots.set(job.jobId, JSON.stringify(observed.result));
    configuration.pending = event;
    await persist();
    channel.send(JSON.stringify(event));
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
  channel.send(
    JSON.stringify({
      version: 1,
      type: "reconcile",
      sessionId: configuration.sessionId,
      sequence: configuration.sequence,
      jobs: configuration.jobs,
      executorVersion: 1,
      cliExecutorVersion: 1,
      githubAccessVersion: 1,
      pagesAccessVersion: 1,
      interpreters: await interpreters(),
      tools: await toolInventory(),
    }),
  );
}

async function receiveReconciliation(message) {
  if (message.state.sessionId !== configuration.sessionId)
    throw new UnrecoverableError("Counterpart reconciled another session.");
  if (
    configuration.pending &&
    configuration.pending.sequence <= message.state.sequence
  )
    configuration.pending = null;
  configuration.sequence = message.state.sequence;
  configuration.jobs = message.state.jobs;
  await persist();
  attempts = 0;
}

function receiveProvider(message, channel) {
  if (isProviderBusy || !/^[a-f0-9-]{36}$/.test(message.requestId))
    throw new Error("Invalid provider command");
  isProviderBusy = true;
  void handleProvider(message, channel)
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
        channel.send(JSON.stringify(reply));
    })
    .catch(() => channel.close())
    .finally(() => {
      isGitHubBusy = false;
    });
}

async function connect() {
  await new Promise((resolve) => {
    socket = new WebSocket(endpoint, [
      "pages-runner.v1",
      `credential.${configuration.token}`,
    ]);
    const channel = socket;
    const state = {
      isReconciled: false,
      isPolling: false,
      chain: Promise.resolve(),
      heartbeat: null,
      deadline: null,
      poll: null,
    };
    const timeout = setTimeout(() => channel.close(), 15000);
    const enqueue = (work) => {
      state.chain = state.chain.then(work).catch((error) => {
        if (error instanceof UnrecoverableError) unrecoverable = error;
        else console.error("Runner protocol failed; reconciliation required.");
        channel.close();
      });
    };
    const deadline = () => {
      clearTimeout(state.deadline);
      state.deadline = setTimeout(() => channel.close(), 45000);
    };
    channel.addEventListener("error", () => channel.close());
    channel.addEventListener("message", (event) =>
      enqueue(async () => {
        const message = JSON.parse(event.data);
        if (message.version !== 1)
          throw new UnrecoverableError("Unsupported protocol version.");
        if (message.type === "registered") {
          await receiveRegistration(message, channel);
          return;
        }
        if (message.type === "reconcile") {
          await receiveReconciliation(message);
          state.isReconciled = true;
          clearTimeout(timeout);
          state.poll = setInterval(() => {
            if (state.isPolling) return;
            state.isPolling = true;
            enqueue(async () => {
              try {
                await pollJobs(channel);
              } finally {
                state.isPolling = false;
              }
            });
          }, 500);
          state.heartbeat = setInterval(
            () =>
              channel.send(
                JSON.stringify({
                  version: 1,
                  type: "heartbeat",
                  sessionId: configuration.sessionId,
                }),
              ),
            15000,
          );
          deadline();
          return;
        }
        if (!state.isReconciled) throw new Error("Reconciliation required");
        if (message.type === "pages-result") {
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
        } else if (message.type === "heartbeat") deadline();
        else if (message.type === "refresh-tools") {
          inventory.checkedAt = 0;
          channel.close();
        } else if (message.type === "openrouter")
          receiveProvider(message, channel);
        else if (message.type === "github-access")
          receiveGitHub(message, channel);
        else await receiveJob(message);
      }),
    );
    channel.addEventListener("close", () => {
      clearTimeout(timeout);
      clearInterval(state.heartbeat);
      clearInterval(state.poll);
      clearTimeout(state.deadline);
      for (const pending of pagesRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Pages channel closed"));
      }
      pagesRequests.clear();
      resolve();
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
