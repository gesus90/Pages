// Pages protocol v1 with durable execution claims and detached workers.
import {
  claimJob,
  observeJob,
  cancelJob,
  interpreters,
  store,
} from "./execution.mjs";
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

const RUNNER_VERSION = "1.2.0";
if (process.argv.includes("--version")) {
  console.info(`pages-runner ${RUNNER_VERSION}`);
  process.exit(0);
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

/** Validates authentication separately because the public model catalog cannot prove it. */
async function checkProviderKey(apiKey) {
  const response = await providerRequest("key", apiKey);
  await response.body?.cancel();
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
  const prices = [model.pricing?.prompt, model.pricing?.completion];
  const isFree = prices.every(
    (price) =>
      typeof price === "string" && price.trim() !== "" && Number(price) === 0,
  );
  return { id: model.id, name: model.name, isFree };
}

/** Validates a new key and catalog before replacing the previous provider configuration. */
async function syncProvider(apiKey) {
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{16,512}$/.test(apiKey))
    throw new Error("Invalid provider credential");
  await checkProviderKey(apiKey);
  const response = await providerRequest("models", apiKey);
  const catalog = await response.json();
  if (!Array.isArray(catalog?.data) || catalog.data.length > 10000)
    throw new Error("Invalid OpenRouter catalog");
  const models = catalog.data.map((model) => catalogModel(model, apiKey));
  const syncedAt = new Date().toISOString();
  const freeModels = models
    .filter((model) => model.isFree)
    .map(({ id, name }) => ({ id, name }));
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
  };
}

/** Checks the stored credential and sends a bounded prompt using a synchronized free model. */
async function checkProvider(model) {
  const stored = JSON.parse(
    await readFile(join(directory, "openrouter.json"), "utf8"),
  );
  if (!stored.models.some((entry) => entry.id === model && entry.isFree))
    throw new Error("Synchronized free model required");
  await checkProviderKey(stored.apiKey);
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
  };
}

/** Returns allowlisted status fields only, including on provider or storage failures. */
async function handleProvider(message, channel) {
  let result;
  try {
    if (message.operation === "sync")
      result = await syncProvider(message.apiKey);
    else if (message.operation === "check")
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
          .map(({ id, name }) => ({ id, name })),
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
let configuration;
try {
  configuration = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("Runner configuration unreadable");
}
if (!configuration) {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const endpoint = await terminal.question(
    "Pages WS/WSS-URL (/runner/v1/channel/CONNECTION-ID): ",
  );
  const token = await terminal.question(
    "Kurzlebige Registrierungsfreigabe (sichtbare lokale Eingabe): ",
  );
  terminal.close();
  configuration = { endpoint, token, sessionId: null, sequence: 0, jobs: [] };
}
const endpoint = new URL(configuration.endpoint);
if (
  !["ws:", "wss:"].includes(endpoint.protocol) ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash ||
  !/^\/runner\/v1\/channel\/[a-f0-9-]{36}$/.test(endpoint.pathname) ||
  !/^[A-Za-z0-9_-]{43}$/.test(configuration.token)
) {
  throw new Error("Invalid runner endpoint or credential");
}
let attempts = 0;
let stopped = false;
let socket;
let isProviderBusy = false;
const progressSnapshots = new Map();
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function receiveRegistration(message, channel) {
  if (message.token) configuration.token = message.token;
  if (configuration.sessionId && configuration.sessionId !== message.sessionId)
    throw new Error("Runner session changed");
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
      interpreters: await interpreters(),
    }),
  );
}

async function receiveReconciliation(message) {
  if (message.state.sessionId !== configuration.sessionId)
    throw new Error("Runner session mismatch");
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
      state.chain = state.chain.then(work).catch(() => {
        console.error("Runner protocol failed; reconciliation required.");
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
        if (message.version !== 1) throw new Error("Unsupported protocol");
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
        if (message.type === "heartbeat") deadline();
        else if (message.type === "openrouter")
          receiveProvider(message, channel);
        else await receiveJob(message);
      }),
    );
    channel.addEventListener("close", () => {
      clearTimeout(timeout);
      clearInterval(state.heartbeat);
      clearInterval(state.poll);
      clearTimeout(state.deadline);
      resolve();
    });
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
    socket?.close();
  });
while (!stopped && attempts < 5) {
  try {
    await connect();
  } catch {
    console.error("Runner connection unavailable.");
  }
  attempts += 1;
  if (!stopped) await sleep(Math.min(30000, 1000 * 2 ** attempts));
}
if (!stopped) {
  console.error("Runner stopped after five failed reconnects.");
  process.exitCode = 1;
}
