import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnCli, cliOutput } from "./cli.mjs";
import { preparePagesFiles, pagesRequest, pagesFailure } from "./pages.mjs";

const credentials =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]+|Bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[=:]\s*["']?[^\s"']+)/gi;

/** Writes and syncs private state before exposing it to the transport. */
export async function store(destination, contents) {
  const pending = `${destination}.${randomUUID()}`;
  const handle = await open(pending, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(contents));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(pending, destination);
  const parent = await open(join(destination, ".."), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

/** Missing records are distinct from malformed or inaccessible records. */
export async function readRecord(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("Private runner record unreadable");
  }
}

/** Binds process ownership to Linux start time, avoiding PID reuse. */
export async function identity(pid) {
  try {
    const contents = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = contents.slice(contents.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}

/** Discovers only fixed runner-owned interpreter paths, with content-bound identities. */
export async function interpreters() {
  const profiles = [];
  for (const [id, name, path] of [
    ["bash", "Bash", "/usr/bin/bash"],
    ["python3", "Python 3", "/usr/bin/python3"],
    ["node", "Node.js", process.execPath],
  ]) {
    try {
      const binary = await readFile(path);
      const metadata = await stat(path);
      if (!metadata.isFile() || !(metadata.mode & 0o111)) continue;
      profiles.push({
        id,
        name,
        path,
        digest: createHash("sha256").update(binary).digest("hex"),
        version: `${name} · ${createHash("sha256").update(binary).digest("hex").slice(0, 12)}`,
      });
    } catch {
      continue;
    }
  }
  return profiles;
}

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

async function ownedProcesses(marker) {
  const owned = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if ((await stat(`/proc/${entry}`)).uid !== process.getuid()) continue;
      const environment = await readFile(`/proc/${entry}/environ`, "utf8");
      if (environment.split("\0").includes(`PAGES_REMOTE_JOB=${marker}`))
        owned.push(Number(entry));
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return owned;
}

async function cleanup(folder, jobId) {
  const child = await readRecord(join(folder, "child.json"));
  if (child && (await identity(child.processId)) === child.identity) {
    try {
      process.kill(-child.processId, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  for (const pid of await ownedProcesses(jobId)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const remaining = await ownedProcesses(jobId);
  const alive = await Promise.all(remaining.map(identity));
  if (alive.some(Boolean)) return "failed";
  await rm(join(folder, "runtime"), { recursive: true, force: true });
  return "confirmed";
}

/** Reads actual worker state; no exit evidence means lost and never an implicit retry. */
export async function observeJob(directory, job) {
  const folder = join(directory, "jobs", job.jobId);
  const claim = await readRecord(join(folder, "claim.json"));
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
  if (result) return { launch, ...result };
  if (launch && (await identity(launch.processId)) === launch.identity) {
    const progress = await readRecord(join(folder, "progress.json"));
    return {
      launch,
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
  return { launch, ...lost };
}

/** Cancellation survives a disconnected channel and is acknowledged through terminal cleanup evidence. */
export async function cancelJob(directory, jobId) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Invalid cancellation");
  const folder = join(directory, "jobs", jobId);
  if (await readRecord(join(folder, "claim.json")))
    await store(join(folder, "cancel.json"), { requested: true });
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
    throw new Error("Workspace changed");
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
      throw new Error("Interpreter changed");
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

function spawnScript(command, folder, jobId) {
  const runtime = join(folder, "runtime");
  const interpreter = command.program.interpreter;
  const nodeArguments =
    interpreter.id === "node"
      ? ["--jitless", "--no-expose-wasm", "--max-old-space-size=128"]
      : [];
  const limits = [
    `--cpu=${command.timeoutSeconds + 1}`,
    "--nproc=128",
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

async function processJob(command, folder, context) {
  const { jobId, signal } = context;
  const isCli = command.program.kind === "cli";
  const child = isCli
    ? await spawnCli(command, jobId, signal, folder)
    : spawnScript(command, folder, jobId);
  let output = "";
  let diagnostic = "";
  const outputDecoder = new TextDecoder("utf-8", { fatal: true });
  const diagnosticDecoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let failure = null;
  const completion = new Promise((resolve) => {
    child.once("error", () =>
      resolve({ exitCode: null, signal: null, reason: "spawn" }),
    );
    child.once("close", (exitCode, exitSignal) =>
      resolve({
        exitCode,
        signal: exitSignal,
        reason: failure ?? exitReason(exitCode, exitSignal),
      }),
    );
  });
  if (child.pid)
    await store(join(folder, "child.json"), {
      processId: child.pid,
      identity: await identity(child.pid),
    });
  const receive = (chunk, channel) => {
    bytes += chunk.length;
    if (
      bytes >
      (isCli && command.pagesAccess === 1
        ? 32 * 1024 * 1024
        : command.outputBytes)
    ) {
      failure = "output_limit";
      stop();
      return;
    }
    try {
      if (channel === "stdout")
        output += outputDecoder.decode(chunk, { stream: true });
      else diagnostic += diagnosticDecoder.decode(chunk, { stream: true });
    } catch {
      failure = "exit";
      stop();
    }
  };
  const stop = () => {
    void cleanup(folder, jobId).catch(() => {
      failure = "spawn";
    });
  };
  child.stdout.on("data", (chunk) => receive(chunk, "stdout"));
  child.stderr.on("data", (chunk) => receive(chunk, "stderr"));
  child.stdin.on("error", () => {
    failure = "spawn";
    stop();
  });
  child.stdin.end(isCli ? command.program.prompt : command.input);
  const abort = () => {
    failure = signal.reason === "timeout" ? "timeout" : "cancelled";
    stop();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const progress = setInterval(() => {
    void store(join(folder, "progress.json"), {
      output: safeOutput(isCli ? cliOutput(command, output) : output),
      closeout: "pending",
    }).catch(stop);
  }, 1000);
  try {
    const result = await completion;
    try {
      output += outputDecoder.decode();
      diagnostic += diagnosticDecoder.decode();
    } catch {
      result.reason = "exit";
    }
    if (
      isCli &&
      Buffer.byteLength(cliOutput(command, output)) +
        Buffer.byteLength(diagnostic) >
        command.outputBytes
    )
      result.reason = "output_limit";
    return {
      ...result,
      ...(isCli && result.exitCode === 0 && !cliOutput(command, output)
        ? { exitCode: 1, reason: "exit" }
        : {}),
      output: safeOutput(isCli ? cliOutput(command, output) : output),
      stderr: safeOutput(diagnostic),
    };
  } finally {
    clearInterval(progress);
    signal.removeEventListener("abort", abort);
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
    if (
      bytes >
      (isCli && command.pagesAccess === 1
        ? 32 * 1024 * 1024
        : command.outputBytes)
    ) {
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
  const cancel = setInterval(() => {
    void readRecord(join(folder, "cancel.json"))
      .then((record) => {
        if (record) controller.abort("cancelled");
      })
      .catch(() => controller.abort("cancelled"));
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
            .catch(() => controller.abort("cancelled"))
            .finally(() => {
              leaseBusy = false;
            });
        }, 5000)
      : null;
  let result;
  try {
    let command = await checkedCommand(job, folder);
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
            jobId: job.jobId,
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
      reason: controller.signal.aborted
        ? String(controller.signal.reason)
        : "spawn",
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
