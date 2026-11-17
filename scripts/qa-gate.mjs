import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

/** Version of the evidence format; a reader refuses every other one. */
export const QA_GATE_RUNNER = "qa-gate-v1";

/** Exit code of a gate whose checks reported code findings for a repair. */
export const QA_CODE_EXIT_CODE = 1;

/** Exit code of a gate that could not judge the code; no repair can fix it. */
export const QA_INFRASTRUCTURE_EXIT_CODE = 3;

/**
 * The smallest soft address space limit under which the project checks start.
 * @remarks
 * The type check asks V8 for a 4 GiB heap and ESLint for 2 GiB per block; V8
 * reserves address space for its heap and code range on top of that at start.
 * Below this limit Node or the Rust tools of the toolchain abort with an
 * allocator message before any finding, so the gate refuses at once and names
 * the limit instead of handing an allocator abort to a code repair.
 */
export const QA_MINIMUM_ADDRESS_SPACE_BYTES = 8 * 1024 * 1024 * 1024;

const STEP_TIMEOUT_MILLISECONDS = 30 * 60_000;
const STOP_GRACE_MILLISECONDS = 10_000;
const OUTPUT_TAIL_CHARACTERS = 256 * 1024;
const TICKET_ASSET_PREFIX = ".pages-assets-";

/** Messages of a process that ran out of memory, address space or descriptors. */
const RESOURCE_PATTERNS = [
  /memory allocation of \d+ bytes failed/i,
  /out of memory/i,
  /Failed to reserve virtual memory/i,
  /Cannot allocate memory/i,
  /\bENOMEM\b/,
  /\bEMFILE\b/,
  /\bENOSPC\b/,
  /File size limit exceeded/i,
];

/** Messages of a tool or package manager that did not start. */
const START_PATTERNS = [
  /\bEACCES\b/,
  /permission denied/i,
  /command not found/i,
  /^Error: Cannot find module/m,
  /\bERR_PNPM_[A-Z_]+/,
  /Usage Error/i,
  /\[lint\] (?:ABORTED|Fatal|Configuration error)/,
];

/**
 * The checked steps of the gate, in order.
 * @remarks
 * A step passes only with its exit code 0 and its own pass message; an empty
 * or cut log is never a pass. Only the listed findings count as code errors.
 */
export const QA_STEPS = [
  { name: "pnpm", args: ["pnpm", "--version"], passed: /^\d+\.\d+\.\d+/m },
  {
    name: "check",
    args: ["pnpm", "run", "check"],
    passed: /All matched files use Prettier code style/,
    findings: [/error TS\d+/, /\[warn\] Code style issues/],
  },
  {
    name: "lint",
    args: ["pnpm", "run", "lint"],
    passed: /\[lint\] PASSED/,
    findings: [/\[lint\] FAILED: Lint findings/],
  },
];

/** The steps whose pass the verification requires. */
const REQUIRED_STEPS = QA_STEPS.map((step) => step.name);

/**
 * Names an exit code; a code above 128 is the signal a shell reports.
 * @returns For example `153 (SIGXFSZ)`, or the plain code.
 */
export function describeExitCode(code) {
  const name = signalOfExitCode(code);
  return name ? `${code} (${name})` : String(code);
}

function signalOfExitCode(code) {
  if (typeof code !== "number" || code <= 128 || code > 128 + 64) return null;
  return (
    Object.entries(os.constants.signals).find(
      ([, number]) => number === code - 128,
    )?.[0] ?? null
  );
}

function infrastructure(reason) {
  return { outcome: "infrastructure", reason };
}

function infrastructureOfStart(result) {
  if (result.spawnError) return infrastructure(`spawn:${result.spawnError}`);
  if (result.signal) return infrastructure(`signal:${result.signal}`);
  if (result.timedOut) return infrastructure("timeout");
  if (RESOURCE_PATTERNS.some((pattern) => pattern.test(result.output)))
    return infrastructure("resource");
  const signal = signalOfExitCode(result.exitCode);
  if (signal) return infrastructure(`signal:${signal}`);
  if (result.exitCode === 126 || result.exitCode === 127)
    return infrastructure("command_unavailable");
  if (START_PATTERNS.some((pattern) => pattern.test(result.output)))
    return infrastructure("start");
  return null;
}

/** The output of the tools, without the script headers and exit lines of pnpm. */
function toolOutput(output) {
  return output
    .split("\n")
    .filter((line) => !/^\s*(?:> |\$ |\S*ELIFECYCLE)/.test(line))
    .join("\n")
    .trim();
}

/**
 * Judges one finished step.
 * @param step - An entry of {@link QA_STEPS}.
 * @param result - Exit code, signal, start error, timeout and output of the step.
 * @returns `passed`, `code` for findings a repair can fix, or `infrastructure`
 * with the concrete reason; start, signal and resource failures win over
 * findings, and an unrecognised failure is never a code error.
 */
export function classifyQaStep(step, result) {
  const failure = infrastructureOfStart(result);
  if (failure) return failure;
  if (result.exitCode === 0) {
    return step.passed.test(result.output)
      ? { outcome: "passed", reason: null }
      : infrastructure("pass_evidence_missing");
  }
  if (step.findings?.some((pattern) => pattern.test(result.output)))
    return { outcome: "code", reason: "findings" };
  return infrastructure(
    toolOutput(result.output) === ""
      ? `empty_output:${describeExitCode(result.exitCode)}`
      : `unrecognized_exit:${describeExitCode(result.exitCode)}`,
  );
}

/**
 * Reads the soft address space limit from the text of `/proc/self/limits`.
 * @returns The limit in bytes, or `null` when it is unlimited or not listed.
 */
export function readAddressSpaceLimit(limitsText) {
  const line = limitsText
    .split("\n")
    .find((entry) => entry.startsWith("Max address space"));
  const soft = line?.slice("Max address space".length).trim().split(/\s+/)[0];
  return soft && /^\d+$/.test(soft) ? Number(soft) : null;
}

function currentAddressSpaceLimit() {
  const file = "/proc/self/limits";
  return existsSync(file)
    ? readAddressSpaceLimit(readFileSync(file, "utf8"))
    : null;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

/**
 * The commit and cleanliness of a checkout.
 * @returns `head` is `null` when Git cannot answer; ticket assets of a run
 * are no change of the checked tree.
 */
export function readCheckout(root) {
  const head = git(root, ["rev-parse", "HEAD"])?.trim() ?? null;
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  const changes = (status ?? "")
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.slice(3).startsWith(TICKET_ASSET_PREFIX));
  return { head, isClean: status !== null && changes.length === 0 };
}

function stepEnvironment() {
  return {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH ?? ""].join(
      path.delimiter,
    ),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
}

function appendTail(tail, chunk) {
  const text = tail + chunk.toString("utf8");
  return text.length > OUTPUT_TAIL_CHARACTERS
    ? text.slice(-OUTPUT_TAIL_CHARACTERS)
    : text;
}

function signalGroup(child, signal) {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function watchStep(child, signal) {
  const watch = { timedOut: false, release: null };
  const stop = () => {
    signalGroup(child, "SIGTERM");
    setTimeout(
      () => signalGroup(child, "SIGKILL"),
      STOP_GRACE_MILLISECONDS,
    ).unref();
  };
  const limit = setTimeout(() => {
    watch.timedOut = true;
    stop();
  }, STEP_TIMEOUT_MILLISECONDS);
  signal?.addEventListener("abort", stop, { once: true });
  watch.release = () => {
    clearTimeout(limit);
    signal?.removeEventListener("abort", stop);
  };
  return watch;
}

/**
 * Runs one step through Corepack, the package manager the lockfile names.
 * @remarks
 * The step gets its own process group, as in `command-step.mjs`, so a time
 * limit or Stop ends every tool it started; it keeps the resource limits and
 * the cgroup of the caller, so the runner's limits and closeout still reach
 * it. The log is written in full; the judgement reads its tail.
 */
export function runQaStep(step, options) {
  return new Promise((resolve) => {
    const log = createWriteStream(options.logFile, { mode: 0o600 });
    const child = spawn(options.command ?? "corepack", step.args, {
      cwd: options.root,
      detached: true,
      env: options.env ?? stepEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const watch = watchStep(child, options.signal);
    let output = "";
    let spawnError = null;
    const collect = (chunk) => {
      output = appendTail(output, chunk);
      log.write(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      spawnError = error.code ?? error.message;
    });
    child.once("close", (exitCode, signal) => {
      watch.release();
      log.end(() =>
        resolve({
          exitCode,
          signal,
          spawnError,
          timedOut: watch.timedOut,
          output,
        }),
      );
    });
  });
}

function readEvidence(file) {
  if (!file || !existsSync(file)) return null;
  try {
    const evidence = JSON.parse(readFileSync(file, "utf8"));
    return evidence?.runner === QA_GATE_RUNNER ? evidence : null;
  } catch {
    // Unreadable evidence proves nothing; the reader treats it as missing.
    return null;
  }
}

function writeEvidence(file, evidence) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, file);
}

/**
 * Why the gate may not start the checks on this checkout.
 * @returns The infrastructure reason, or `null` when the steps may run.
 */
export function refusalBeforeSteps(context) {
  if (!context.checkout.head) return "git_unavailable";
  if (!context.checkout.isClean) return "worktree_dirty";
  const previous = context.previous;
  if (previous && previous.head === context.checkout.head && !previous.ok)
    return `unchanged_head_after_failure:${previous.reason ?? previous.outcome}`;
  const limit = context.addressSpaceLimit;
  if (limit !== null && limit < QA_MINIMUM_ADDRESS_SPACE_BYTES)
    return `address_space_limit:${limit}`;
  return null;
}

function expectedPnpmVersion(root) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  return String(manifest.packageManager ?? "").replace(/^pnpm@/, "") || null;
}

/** The verdict of a step, with the pnpm version held to the `packageManager` field. */
function stepVerdict(step, result, expectedPnpm) {
  const verdict = classifyQaStep(step, result);
  const version = result.output.trim();
  if (step.name !== "pnpm" || verdict.outcome !== "passed") return verdict;
  return expectedPnpm && version !== expectedPnpm
    ? infrastructure(`pnpm_version:${version}!=${expectedPnpm}`)
    : verdict;
}

async function runSteps(options, logDirectory) {
  const steps = [];
  const expectedPnpm = expectedPnpmVersion(options.root);
  for (const step of options.steps ?? QA_STEPS) {
    const logFile = path.join(logDirectory, `${step.name}.log`);
    const result = await runQaStep(step, { ...options, logFile });
    const verdict = stepVerdict(step, result, expectedPnpm);
    steps.push({
      name: step.name,
      exitCode: result.exitCode,
      signal: result.signal,
      spawnError: result.spawnError,
      timedOut: result.timedOut,
      outcome: verdict.outcome,
      reason: verdict.reason,
      logFile,
      ...(step.name === "pnpm" ? { version: result.output.trim() } : {}),
    });
    if (verdict.outcome === "infrastructure") break;
  }
  return steps;
}

function overallOf(steps, refusal) {
  if (refusal) return infrastructure(refusal);
  const failed = steps.find((step) => step.outcome === "infrastructure");
  if (failed) return infrastructure(`${failed.name}:${failed.reason}`);
  if (steps.some((step) => step.outcome === "code"))
    return { outcome: "code", reason: "findings" };
  return { outcome: "passed", reason: null };
}

/** Where the logs of one gate run go: below the Git directory, never in the tree. */
export function qaLogDirectory(root, now = new Date()) {
  const base = git(root, ["rev-parse", "--absolute-git-dir"])?.trim();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const directory = path.join(
    base ?? path.join(root, ".git"),
    "pages-qa",
    stamp,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

/**
 * Runs pnpm, check and lint once on the committed HEAD and writes the evidence.
 * @remarks
 * An infrastructure failure stops the gate before the next step; a code
 * finding lets the next step report its findings too. The evidence is bound
 * to the HEAD before and after the steps; a move of it is a failure.
 * @returns The exit code: 0 passed, {@link QA_CODE_EXIT_CODE} for findings,
 * {@link QA_INFRASTRUCTURE_EXIT_CODE} for everything a repair cannot fix.
 */
export async function runQaGate(options) {
  const startedAt = new Date().toISOString();
  const checkout = readCheckout(options.root);
  const logDirectory = options.logDirectory ?? qaLogDirectory(options.root);
  const evidenceFile =
    options.evidenceFile ?? path.join(logDirectory, "evidence.json");
  let refusal = refusalBeforeSteps({
    checkout,
    previous: readEvidence(options.previousFile),
    addressSpaceLimit:
      options.addressSpaceLimit === undefined
        ? currentAddressSpaceLimit()
        : options.addressSpaceLimit,
  });
  const steps = refusal ? [] : await runSteps(options, logDirectory);
  const after = readCheckout(options.root);
  if (!refusal && (after.head !== checkout.head || !after.isClean))
    refusal = "head_changed_during_qa";
  const overall = overallOf(steps, refusal);
  const evidence = {
    runner: QA_GATE_RUNNER,
    head: checkout.head,
    node: process.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: overall.outcome === "passed",
    outcome: overall.outcome,
    reason: overall.reason,
    steps,
  };
  writeEvidence(evidenceFile, evidence);
  console.info(JSON.stringify({ ...evidence, evidenceFile }));
  if (evidence.ok) return 0;
  return overall.outcome === "code"
    ? QA_CODE_EXIT_CODE
    : QA_INFRASTRUCTURE_EXIT_CODE;
}

/**
 * Why evidence does not prove a green QA of the checkout now.
 * @returns Empty only when every required step passed without signal or start
 * error on exactly this clean HEAD; a loop count never replaces it.
 */
export function evidenceIssues(evidence, checkout) {
  if (!evidence) return ["evidence_missing"];
  const issues = [];
  if (!evidence.ok || evidence.outcome !== "passed") issues.push("not_passed");
  if (!checkout.head || evidence.head !== checkout.head)
    issues.push("head_mismatch");
  if (!checkout.isClean) issues.push("worktree_dirty");
  for (const name of REQUIRED_STEPS) {
    const step = evidence.steps?.find((entry) => entry.name === name);
    const isClean =
      step?.outcome === "passed" &&
      step.exitCode === 0 &&
      step.signal === null &&
      step.spawnError === null;
    if (!isClean) issues.push(`step_not_passed:${name}`);
  }
  return issues;
}

/**
 * Checks evidence against the checkout now and prints the verdict.
 * @returns 0 for a proven green QA, 1 otherwise.
 */
export function verifyQaEvidence(root, evidenceFile) {
  const issues = evidenceIssues(readEvidence(evidenceFile), readCheckout(root));
  console.info(JSON.stringify({ ok: issues.length === 0, issues }));
  return issues.length === 0 ? 0 : 1;
}
