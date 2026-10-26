import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { accountTasks, cleanup } from "./processes.mjs";
import { interpreters } from "./interpreters.mjs";
export { interpreters, interpreterCatalog } from "./interpreters.mjs";
import { spawnCli } from "./cli.mjs";
import {
  preparePagesFiles,
  pagesRequest,
  pagesFailure,
  notifyJobCompletion,
} from "./pages.mjs";
import { JobOutput, outputBinding } from "./output.mjs";
import { readJournalEvents } from "./chunks.mjs";
import { store, readRecord, identity } from "./journal.mjs";

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

/** A persistent claim is never spawned a second time, even after a bootstrap crash. */
export async function claimJob(directory, job) {
  if (
    !/^[a-f0-9-]{36}$/.test(job.jobId) ||
    !job.plan ||
    job.execution?.version !== 1
  )
    throw new Error("Invalid dispatch");
  const folder = join(directory, "jobs", job.jobId);
  await mkdir(join(directory, "jobs"), { recursive: true, mode: 0o700 });
  try {
    await mkdir(folder, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
  await store(join(folder, "claim.json"), job);
  // A stop that arrived during admission must not start the worker.
  if (await cancellationFor(directory, job)) {
    await store(join(folder, "result.json"), {
      status: "interrupted",
      result: {
        output: null,
        closeout: "confirmed",
        exitCode: null,
        signal: null,
        reason: "cancelled",
      },
    });
    return;
  }
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--job", folder],
    {
      detached: true,
      stdio: "ignore",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: directory,
        LANG: "C.UTF-8",
        NODE_OPTIONS: "--max-old-space-size=128",
        PAGES_RUNNER_CLI_HOME: process.env.PAGES_RUNNER_CLI_HOME ?? homedir(),
        PAGES_RUNNER_CLI_PATH: process.env.PATH,
      },
    },
  );
  child.on("error", () => {
    /* The durable claim reconciles as lost if launch never confirms. */
  });
  child.unref();
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
  return { launch, ...failure };
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
  const launch = await readRecord(join(folder, "launch.json"));
  const result = await readRecord(join(folder, "result.json"));
  const historyFailure = await readRecord(join(folder, "history-failure.json"));
  if (historyFailure)
    return {
      launch,
      ...historyFailure,
      history: historyFailure.history.filter(
        (event) => event.sequence > (job.historyCursor ?? 0),
      ),
    };
  let history;
  let historyLength;
  try {
    if (job.outputJournalVersion === 2 && launch) {
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
  if (result) return { launch, ...observedHistory, ...result };
  if (launch && (await identity(launch.processId)) === launch.identity) {
    const progress = await readRecord(join(folder, "progress.json"));
    return {
      launch,
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
  return { launch, ...observedHistory, ...lost };
}

/** Validates persisted delivery against the exact session and attempt before acknowledging it. */
export async function cancellationFor(directory, job) {
  const request = await readRecord(
    join(directory, "jobs", `${job.jobId}.cancel.json`),
  );
  if (!request) return null;
  if (
    request.sessionId !== job.sessionId ||
    request.attemptId !== job.plan?.attemptId
  )
    throw new Error("Runner cancellation identity mismatch");
  return { requestedAt: request.requestedAt, receivedAt: request.receivedAt };
}

async function endQueuedJob(directory, job, terminal) {
  const folder = join(directory, "jobs", job.jobId);
  if (await readRecord(join(folder, "claim.json"))) return;
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await store(join(folder, "claim.json"), job);
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
export async function refuseQueuedJob(directory, job) {
  await endQueuedJob(directory, job, {
    status: "failed",
    result: { reason: "spawn", failureCode: "plan_runner_admission_failed" },
  });
}

/** Stop delivery uses an independent small file, including jobs that have never launched. */
export async function cancelJob(directory, job) {
  if (!/^[a-f0-9-]{36}$/u.test(job.jobId) || !job.plan || !job.cancellation)
    throw new Error("Invalid cancellation");
  await mkdir(join(directory, "jobs"), { recursive: true, mode: 0o700 });
  if (await cancellationFor(directory, job)) return;
  await store(join(directory, "jobs", `${job.jobId}.cancel.json`), {
    sessionId: job.sessionId,
    attemptId: job.plan.attemptId,
    requestedAt: job.cancellation.requestedAt,
    receivedAt: new Date().toISOString(),
  });
}

async function checkedCommand(job, folder) {
  const command = job.execution;
  if (
    !command ||
    command.revision !== job.plan.planRevision ||
    command.timeoutSeconds < 0 ||
    (command.timeoutSeconds === 0 && command.program.kind !== "cli") ||
    command.timeoutSeconds > 86400 ||
    command.outputBytes > 65536 ||
    Buffer.byteLength(command.input) > 1048576
  )
    throw new Error("Invalid execution bounds");
  if (
    (await realpath(command.workspace)) !== command.workspace ||
    !(await stat(command.workspace)).isDirectory()
  )
    throw Object.assign(new Error("Workspace changed"), {
      failureCode: "plan_context_changed",
    });
  const runtime = join(folder, "runtime");
  await mkdir(runtime, { mode: 0o700 });
  if (command.program.kind === "script") {
    const profile = (await interpreters()).find(
      (entry) => entry.id === command.program.interpreter.id,
    );
    if (
      !profile ||
      profile.path !== command.program.interpreter.path ||
      profile.digest !== command.program.interpreter.digest
    )
      throw Object.assign(new Error("Interpreter changed"), {
        failureCode: "plan_script_interpreter_unavailable",
      });
    const script = await open(join(runtime, "source.cjs"), "wx", 0o600);
    try {
      await script.writeFile(command.program.source);
      await script.sync();
    } finally {
      await script.close();
    }
  }
  return command;
}

// RLIMIT_NPROC counts all threads of the account, so a fixed 128 fails every fork
// as soon as parallel agents run; scripts get this headroom above current use.
const SCRIPT_TASK_HEADROOM = 256;

function spawnScript(command, folder, jobId, accountTaskCount) {
  const runtime = join(folder, "runtime");
  const interpreter = command.program.interpreter;
  const nodeArguments =
    interpreter.id === "node"
      ? ["--jitless", "--no-expose-wasm", "--max-old-space-size=128"]
      : [];
  const limits = [
    `--cpu=${command.timeoutSeconds + 1}`,
    `--nproc=${accountTaskCount + SCRIPT_TASK_HEADROOM}`,
    "--nofile=128",
    "--fsize=10485760",
    "--core=0",
  ];
  limits.push(interpreter.id === "node" ? "--as=1073741824" : "--as=536870912");
  return spawn(
    "/usr/bin/prlimit",
    [
      ...limits,
      "--",
      interpreter.path,
      ...nodeArguments,
      join(runtime, "source.cjs"),
    ],
    {
      cwd: command.workspace,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: runtime,
        TMPDIR: runtime,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PAGES_REMOTE_JOB: jobId,
      },
    },
  );
}

function outputFailure(error) {
  const reasons = ["event_limit", "protocol", "output_limit", "result_limit"];
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
  const child =
    command.program.kind === "cli"
      ? await spawnCli(command, jobId, signal, folder)
      : spawnScript(command, folder, jobId, await accountTasks());
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
    return {
      ...result,
      ...final,
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
        messages: [{ role: "user", content: program.prompt }],
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
  const job = await readRecord(join(folder, "claim.json"));
  const privateRoot = join(folder, "..", "..");
  const configuration = await readRecord(join(privateRoot, "config.json"));
  const provider = await readRecord(join(privateRoot, "openrouter.json"));
  knownSecrets = [configuration?.token, provider?.apiKey].filter(Boolean);
  const launch = {
    id: randomUUID(),
    processId: process.pid,
    identity: await identity(process.pid),
  };
  await store(join(folder, "launch.json"), launch);
  const controller = new AbortController();
  let isCancelReadBusy = false;
  const cancel = setInterval(() => {
    if (isCancelReadBusy) return;
    isCancelReadBusy = true;
    void cancellationFor(privateRoot, job)
      .then((record) => {
        if (record) controller.abort("cancelled");
      })
      .catch(() => controller.abort("cancelled"))
      .finally(() => {
        isCancelReadBusy = false;
      });
  }, 250);
  const timeout =
    job.execution.timeoutSeconds === 0
      ? null
      : setTimeout(
          () => controller.abort("timeout"),
          job.execution.timeoutSeconds * 1000,
        );
  let leaseBusy = false;
  const lease =
    job.execution.pagesAccess === 1
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
  let result;
  try {
    if (await cancellationFor(privateRoot, job)) controller.abort("cancelled");
    controller.signal.throwIfAborted();
    let command = await checkedCommand(job, folder);
    controller.signal.throwIfAborted();
    if (command.pagesAccess === 1)
      command = await preparePagesFiles(
        command,
        folder,
        job.jobId,
        controller.signal,
      );
    result =
      command.program.kind !== "model"
        ? await processJob(command, folder, {
            job,
            launch,
            signal: controller.signal,
          })
        : await modelJob(command, folder, controller.signal);
  } catch (error) {
    result = {
      ...(job.execution.pagesAccess === 1
        ? { resourceError: pagesFailure(error) }
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
    clearInterval(cancel);
    clearInterval(lease);
    clearTimeout(timeout);
  }
  const closeout = await cleanup(folder, job.jobId);
  const status = terminalStatus(result, closeout);
  await store(join(folder, "result.json"), {
    status,
    result: { ...result, closeout },
  });
  await notifyJobCompletion(privateRoot, job.jobId);
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
