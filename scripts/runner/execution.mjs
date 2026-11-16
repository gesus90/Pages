import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import { fullEnvironmentContext } from "./full-environment.mjs";
import { executeApiRequest, runnerInputText } from "./api.mjs";
import { prepareScript, spawnScript } from "./scripts.mjs";
import { isWorkerStalled, workerControl } from "./worker-control.mjs";
export { claimJob } from "./launch.mjs";
export { sshConfigOverlay } from "./ssh.mjs";
import { accountSecrets } from "./accounts.mjs";
import {
  cancellationFor,
  hasExecutionLease,
  cancelJob,
} from "./revocation.mjs";
export { cancellationFor, cancelJob } from "./revocation.mjs";
import { cleanup } from "./processes.mjs";
import { canOwnNativeJobs, isNativeJob } from "./native.mjs";
export { interpreters, interpreterCatalog } from "./interpreters.mjs";
import { spawnCli, cliEnvironment } from "./cli.mjs";
import {
  pagesRequest,
  preparePagesFiles,
  modelAssetContent,
  pagesFailure,
  notifyJobCompletion,
} from "./pages.mjs";
import { JobOutput, outputBinding } from "./output.mjs";
import { readJournalEvents } from "./chunks.mjs";
import {
  store,
  readRecord,
  readOwnedLaunch,
  identity,
  ownershipDirectory,
} from "./journal.mjs";

export { store, readRecord, identity } from "./journal.mjs";

const credentials =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]+|Bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)["']?\s*[=:]\s*["']?[^\s"']+)/gi;

let knownSecrets = [];

function safeOutput(output, secrets = knownSecrets) {
  let redacted = output;
  for (const secret of secrets)
    if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
  return redacted
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu,
      "[redacted]",
    )
    .replace(
      /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu,
      "[redacted]",
    )
    .replace(
      /((?:refresh[_ -]?token|authorization)["']?\s*[=:]\s*["']?)(?:Bearer\s+)?[^\s,;"'}]+/giu,
      "$1[redacted]",
    )
    .replace(credentials, "[redacted]");
}

/** Whether a launch record names a boundary that owns every process of its job. */
function isOwnedBoundary(launch) {
  return (
    launch?.boundary === "pid_namespace" || launch?.boundary === "worker_unit"
  );
}

function publicLaunch(launch) {
  if (!isOwnedBoundary(launch)) return null;
  return {
    id: launch.id,
    ...(launch.isolationVersion === 1
      ? { isolation: launch.cgroup ? "cgroup_v2" : "pid_namespace" }
      : {}),
    processId: launch.processId,
    identity: launch.identity,
  };
}

async function failedHistory(folder, job, launch) {
  const closeout = await cleanup(folder, job.jobId);
  const terminal = ["completed", "failed", "interrupted", "lost"].includes(
    job.status,
  );
  const sequence = (job.historyCursor ?? 0) + 1;
  const failure = {
    historyFailure: "journal_unreadable",
    historyLength: sequence,
    history: [
      {
        sequence,
        kind: "error",
        channel: "stderr",
        text: "Runner history unavailable: journal storage or integrity check failed. Later diagnostics are missing; confirmed positions were preserved.",
        createdAt: new Date().toISOString(),
        isTruncated: false,
      },
    ],
    status: terminal ? job.status : "failed",
    result: {
      output: null,
      closeout,
      exitCode: null,
      signal: null,
      reason: "storage",
      storageError: "journal_write_failed",
    },
  };
  await store(join(folder, "history-failure.json"), failure);
  return { launch: publicLaunch(launch), ...failure };
}

/** Reads actual worker state; no exit evidence means lost and never an implicit retry. */
export async function observeJob(directory, job) {
  const folder = join(directory, "jobs", job.jobId);
  const claim = await readRecord(join(folder, "claim.json"));
  const cancellation = await cancellationFor(directory, job);
  if (!claim) {
    if (
      job.status === "queued" &&
      Date.now() - (await stat(folder)).mtimeMs < 5000
    )
      return null;
    const closeout = await cleanup(folder, job.jobId);
    return {
      launch: null,
      status: "lost",
      result: {
        output: null,
        closeout,
        exitCode: null,
        signal: null,
        reason: "lost",
      },
    };
  }
  const launch = await readOwnedLaunch(folder);
  const result = await readRecord(join(folder, "result.json"));
  const historyFailure = await readRecord(join(folder, "history-failure.json"));
  if (historyFailure)
    return {
      launch: publicLaunch(launch),
      ...historyFailure,
      history: historyFailure.history.filter(
        (event) => event.sequence > (job.historyCursor ?? 0),
      ),
    };
  let history;
  let historyLength;
  try {
    if (job.outputJournalVersion === 2 && isOwnedBoundary(launch)) {
      const index = await readRecord(
        join(folder, "history", "events", "index.json"),
      );
      if (index) {
        const page = await readJournalEvents(
          join(folder, "history", "events"),
          outputBinding(job, launch),
          job.historyCursor ?? 0,
        );
        history = page.events;
        historyLength = page.length;
      } else if (result) throw new Error("Completed output journal missing");
    } else if (job.liveHistoryVersion === 1)
      history = (await readRecord(join(folder, "history.json")))?.events ?? [];
  } catch {
    return failedHistory(folder, job, launch);
  }
  const observedHistory = {
    history,
    ...(cancellation ? { cancellation } : {}),
    ...(historyLength !== undefined ? { historyLength } : {}),
  };
  if (result) {
    if (
      cancellation &&
      launch?.boundary === "not_started" &&
      result.result?.closeout === "confirmed"
    )
      await cancelJob(directory, { ...job, cancellation });
    const closeout =
      launch?.boundary === "not_started"
        ? result.result?.closeout
        : await cleanup(folder, job.jobId);
    return {
      launch: publicLaunch(launch),
      ...observedHistory,
      ...result,
      result: { ...result.result, closeout },
    };
  }
  if (
    isOwnedBoundary(launch) &&
    (await identity(launch.processId)) === launch.identity
  ) {
    if (
      job.execution?.managed &&
      (await hasStalledWorker(folder, job, launch))
    ) {
      const closeout = await cleanup(folder, job.jobId);
      const failed = {
        status: "lost",
        result: {
          output: null,
          closeout,
          exitCode: null,
          signal: null,
          reason: "lost",
          failureCode: "plan_runner_session_failed",
        },
      };
      await store(join(folder, "result.json"), failed);
      return { launch: publicLaunch(launch), ...observedHistory, ...failed };
    }
    const progress = await readRecord(join(folder, "progress.json"));
    return {
      launch: publicLaunch(launch),
      ...observedHistory,
      status: "running",
      result: progress ?? { output: null, closeout: "pending" },
    };
  }
  if (!launch && Date.now() - (await stat(folder)).mtimeMs < 5000) return null;
  const closeout = await cleanup(folder, job.jobId);
  const lost = {
    status: "lost",
    result: {
      output: null,
      closeout,
      exitCode: null,
      signal: null,
      reason: "lost",
    },
  };
  await store(join(folder, "result.json"), lost);
  return { launch: publicLaunch(launch), ...observedHistory, ...lost };
}

async function hasStalledWorker(folder, job, launch) {
  const [heartbeat, paused] = await Promise.all([
    readRecord(join(folder, "heartbeat.json")),
    readRecord(join(folder, "pause.json")),
  ]);
  return isWorkerStalled({
    jobId: job.jobId,
    heartbeat,
    paused,
    startedAt: launch.startedAt,
    now: Date.now(),
  });
}

async function endQueuedJob(directory, job, terminal) {
  const folder = join(directory, "jobs", job.jobId);
  await mkdir(join(directory, "jobs"), { recursive: true, mode: 0o700 });
  try {
    await mkdir(folder, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
  await store(join(folder, "claim.json"), job);
  const ownership = await ownershipDirectory(directory);
  await store(join(ownership, `${job.jobId}.json`), {
    boundary: "not_started",
  });
  await store(join(folder, "result.json"), {
    status: terminal.status,
    result: {
      output: null,
      closeout: "confirmed",
      exitCode: null,
      signal: null,
      ...terminal.result,
    },
  });
}

/** A queued cancellation has a terminal record without ever creating a worker. */
export async function cancelQueuedJob(directory, job) {
  await endQueuedJob(directory, job, {
    status: "interrupted",
    result: { reason: "cancelled" },
  });
}

/** A host that cannot admit work ends only this queued job, with a named reason. */
export async function refuseQueuedJob(
  directory,
  job,
  failureCode = "plan_runner_admission_failed",
) {
  await endQueuedJob(directory, job, {
    status: "failed",
    result: { reason: "spawn", failureCode },
  });
}

let hasProvenNamespace = false;

/**
 * Proves that this host can own the processes of a job: the scope unit of a
 * native YOLO job, or the PID namespace every other job runs in.
 *
 * Without it no worker may start, because its process tree could not be owned.
 * Only a success is remembered, so a host that is repaired is used again.
 */
export async function canIsolateJobs(job) {
  if (isNativeJob(job)) return canOwnNativeJobs();
  if (hasProvenNamespace) return true;
  const isCreated = await new Promise((resolve) => {
    const probe = spawn(
      "/usr/bin/bwrap",
      [
        "--ro-bind",
        "/",
        "/",
        "--unshare-pid",
        "--proc",
        "/proc",
        "--",
        process.execPath,
        "-e",
        "",
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    probe.once("error", () => resolve(false));
    probe.once("close", (code) => resolve(code === 0));
  });
  hasProvenNamespace = isCreated;
  return isCreated;
}

const SESSION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u;

/** A continuation belongs to a CLI job and names its session in a form no command line could misread. */
function requireContinuation(continuation, program) {
  const resumeSessionId = continuation.resumeSessionId;
  if (
    continuation.version !== 1 ||
    program.kind !== "cli" ||
    (resumeSessionId !== undefined && !SESSION_IDENTIFIER.test(resumeSessionId))
  )
    throw new Error("Invalid continuation");
}

async function checkedCommand(job, folder) {
  const command = job.execution;
  if (
    !command ||
    command.revision !== job.plan.planRevision ||
    command.timeoutSeconds < 0 ||
    (command.timeoutSeconds === 0 &&
      !["cli", "api"].includes(command.program.kind)) ||
    command.timeoutSeconds > 86400 ||
    command.outputBytes > 1048576 ||
    Buffer.byteLength(command.input) > 1048576
  )
    throw new Error("Invalid execution bounds");
  if (command.continuation !== undefined)
    requireContinuation(command.continuation, command.program);
  if (
    (await realpath(command.workspace)) !== command.workspace ||
    !(await stat(command.workspace)).isDirectory()
  )
    throw Object.assign(new Error("Workspace changed"), {
      failureCode: "plan_context_changed",
    });
  const runtime = join(folder, "runtime");
  await mkdir(runtime, { mode: 0o700 });
  if (command.program.kind === "script") await prepareScript(command, runtime);
  return command;
}

function outputFailure(error) {
  const reasons = [
    "event_limit",
    "protocol",
    "output_limit",
    "result_limit",
    "encoding",
  ];
  if (reasons.includes(error.reason)) return { reason: error.reason };
  if (error instanceof TypeError) return { reason: "protocol" };
  const codes = ["ENOSPC", "EDQUOT", "EACCES", "EROFS", "EIO"];
  return {
    reason: "storage",
    storageError: codes.includes(error.code)
      ? error.code
      : "journal_write_failed",
  };
}

function connectOutput(child, output, failed) {
  const pause = () => {
    child.stdout.pause();
    child.stderr.pause();
  };
  const resume = () => {
    child.stdout.resume();
    child.stderr.resume();
  };
  for (const channel of ["stdout", "stderr"])
    child[channel].on("data", (chunk) => {
      if (!output.write({ chunk, channel })) pause();
    });
  output.on("drain", resume);
  return new Promise((resolve) => {
    output.once("error", (error) => {
      failed(error);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve();
    });
    output.once("finish", resolve);
  });
}

function createJobProgress(folder, stop) {
  let writing = null;
  const progress = setInterval(() => {
    if (writing) return;
    writing = store(join(folder, "progress.json"), {
      output: null,
      closeout: "pending",
    })
      .catch(stop)
      .finally(() => {
        writing = null;
      });
  }, 1000);
  return {
    async finish() {
      clearInterval(progress);
      await writing;
    },
    stop() {
      clearInterval(progress);
    },
  };
}

async function processJob(command, folder, context) {
  const { job, launch, signal } = context;
  const jobId = job.jobId;
  const output = new JobOutput(
    command,
    folder,
    outputBinding(job, launch),
    safeOutput,
  );
  await output.initialize(folder);
  signal.throwIfAborted();
  const child =
    command.program.kind === "cli"
      ? await spawnCli(command, jobId, signal, folder)
      : spawnScript(command, folder, jobId);
  let failure = null;
  let cleanupWork = null;
  const stop = () => {
    cleanupWork ??= cleanup(folder, jobId).catch(() => {
      failure ??= { reason: "spawn" };
    });
  };
  const failed = (error) => {
    failure ??= outputFailure(error);
    stop();
  };
  const completion = new Promise((resolve) => {
    child.once("error", () =>
      resolve({ exitCode: null, signal: null, reason: "spawn" }),
    );
    child.once("close", (exitCode, exitSignal) =>
      resolve({
        exitCode,
        signal: exitSignal,
        reason: exitReason(exitCode, exitSignal),
      }),
    );
  });
  const drained = connectOutput(child, output, failed);
  child.stdin.on("error", () => {
    failure ??= { reason: "spawn" };
    stop();
  });
  if (child.pid)
    await store(join(folder, "child.json"), {
      processId: child.pid,
      identity: await identity(child.pid),
    });
  child.stdin.end(
    command.program.kind === "cli" ? command.program.prompt : command.input,
  );
  const abort = () => {
    failure = { reason: signal.reason === "timeout" ? "timeout" : "cancelled" };
    stop();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const progress = createJobProgress(folder, failed);
  try {
    const result = await completion;
    if (!output.destroyed) output.end();
    await drained;
    await cleanupWork;
    await progress.finish();
    const final = output.result();
    const sessionFailure = final.failureCode
      ? undefined
      : output.sessionFailure({
          isStopped: failure !== null,
          exitCode: result.exitCode,
          signal: result.signal,
        });
    return {
      ...result,
      ...final,
      ...(sessionFailure ? { failureCode: sessionFailure } : {}),
      reason: failure?.reason ?? result.reason ?? final.reason ?? null,
      ...(failure?.storageError ? { storageError: failure.storageError } : {}),
    };
  } finally {
    progress.stop();
    signal.removeEventListener("abort", abort);
    await output.close();
  }
}

async function modelJob(command, folder, signal) {
  const directory = join(folder, "..", "..");
  const provider = await readRecord(join(directory, "openrouter.json"));
  const program = command.program;
  if (
    !provider ||
    provider.syncedAt !== program.route.catalogRevision ||
    !provider.models.some((entry) => entry.id === program.model && entry.isFree)
  )
    throw new Error("Model route changed");
  const selected = provider.models.find((entry) => entry.id === program.model);
  const content = await modelAssetContent(
    folder,
    program.prompt,
    selected?.supportsImages,
  );
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: program.model,
        messages: [{ role: "user", content }],
        max_tokens: 512,
      }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Model request refused");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.length;
    if (bytes > command.outputBytes) {
      await reader.cancel();
      return {
        output: null,
        exitCode: 1,
        signal: null,
        reason: "output_limit",
      };
    }
    chunks.push(Buffer.from(chunk.value));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const output = parsed.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim())
    throw new Error("Model output missing");
  return {
    output: safeOutput(output, [provider.apiKey]),
    exitCode: 0,
    signal: null,
    reason: null,
  };
}

function exitReason(exitCode, signal) {
  if (signal === "SIGKILL") return "lost";
  return exitCode === 0 ? null : "exit";
}

function terminalStatus(result, closeout) {
  if (result.reason === "lost") return "lost";
  if (result.reason === "cancelled") return "interrupted";
  return result.exitCode === 0 &&
    result.reason === null &&
    closeout === "confirmed"
    ? "completed"
    : "failed";
}

async function executeWorker(folder) {
  let release = "";
  for await (const chunk of process.stdin) {
    release += chunk.toString();
    if (release.length > 16) throw new Error("Invalid worker release");
  }
  if (release !== "go\n") throw new Error("Worker was not released");
  const job = await readRecord(join(folder, "claim.json"));
  const privateRoot = join(folder, "..", "..");
  const provider = await readRecord(join(privateRoot, "openrouter.json"));
  knownSecrets = [provider?.apiKey].filter(Boolean);
  const launch = await readRecord(join(folder, "launch.json"));
  if (!isOwnedBoundary(launch)) throw new Error("Worker ownership unavailable");
  const controller = workerControl(folder, job, launch);
  let result;
  let isPreparingPages = false;
  try {
    if (
      (await cancellationFor(privateRoot, job)) ||
      !(await hasExecutionLease(privateRoot, job))
    )
      controller.abort("cancelled");
    controller.signal.throwIfAborted();
    let command = await checkedCommand(job, folder);
    if (command.managed?.promptFile && "prompt" in command.program)
      command = {
        ...command,
        program: {
          ...command.program,
          prompt: await runnerInputText(
            join(privateRoot, "pages.sock"),
            job.jobId,
            controller.signal,
            "prompt",
          ),
        },
      };
    knownSecrets.push(
      ...(await accountSecrets(process.env.PAGES_RUNNER_CLI_HOME)),
    );
    controller.signal.throwIfAborted();
    if (command.pagesAccess === 1 && command.program.kind !== "api") {
      isPreparingPages = true;
      command = await preparePagesFiles(
        command,
        folder,
        job.jobId,
        controller.signal,
      );
      isPreparingPages = false;
    }
    controller.signal.throwIfAborted();
    command = await managedCliContext(command, {
      privateRoot,
      jobId: job.jobId,
      signal: controller.signal,
    });
    result = await executeCommand(command, folder, {
      job,
      launch,
      signal: controller.signal,
    });
  } catch (error) {
    result = {
      ...(isPreparingPages
        ? {
            resourceError: pagesFailure(error),
            assetFailure: error.assetFailure,
          }
        : {}),
      output: null,
      exitCode: null,
      signal: null,
      ...(error.failureCode ? { failureCode: error.failureCode } : {}),
      ...(["ENOSPC", "EDQUOT", "EACCES", "EROFS", "EIO"].includes(error.code)
        ? { storageError: error.code }
        : {}),
      reason: controller.signal.aborted
        ? String(controller.signal.reason)
        : ["ENOSPC", "EDQUOT", "EACCES", "EROFS", "EIO"].includes(error.code)
          ? "storage"
          : (error.reason ?? "spawn"),
    };
  } finally {
    await controller.close();
  }
  const closeout = await cleanup(folder, job.jobId);
  const status = terminalStatus(result, closeout);
  await store(join(folder, "result.json"), {
    status,
    result: { ...result, closeout },
  });
  await notifyJobCompletion(privateRoot, job.jobId);
}

async function executeCommand(command, folder, control) {
  if (command.program.kind === "api")
    return executeApiRequest(
      command,
      folder,
      control.job.jobId,
      control.signal,
    );
  if (command.program.kind === "model")
    return modelJob(command, folder, control.signal);
  return processJob(command, folder, control);
}

async function managedCliContext(command, control) {
  if (!command.managed || command.program.kind !== "cli") return command;
  let runtimeContext = await pagesRequest(
    join(control.privateRoot, "pages.sock"),
    control.jobId,
    { kind: "turn-context" },
  );
  const owner = await fullEnvironmentContext(command, control.signal);
  if (owner)
    runtimeContext = {
      ...runtimeContext,
      environment: { ...runtimeContext.environment, ...owner.environment },
      secrets: [...(runtimeContext.secrets ?? []), ...owner.secrets],
    };
  if (runtimeContext.pathPrefix)
    runtimeContext = {
      ...runtimeContext,
      environment: {
        ...runtimeContext.environment,
        PATH: `${runtimeContext.pathPrefix}:${cliEnvironment().PATH}`,
      },
    };
  knownSecrets.push(...(runtimeContext.secrets ?? []));
  if (runtimeContext.auth)
    knownSecrets.push(
      ...Object.values(JSON.parse(runtimeContext.auth)).map(
        (entry) => entry.key,
      ),
    );
  return { ...command, runtimeContext };
}

if (process.argv[2] === "--job") {
  const folder = process.argv[3];
  const metadata = await lstat(folder);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid()
  )
    throw new Error("Invalid worker owner");
  await chmod(folder, 0o700);
  await executeWorker(folder);
}
