import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

import {
  isGeneratedDirectory,
  isSourceFile,
  walkFiles,
} from "./source-population.mjs";

/**
 * Default maximum number of files checked per sequential ESLint process.
 * Raised from 200 to 600 (from 24 to 8 ESLint cold starts across ~4,749 files)
 * to cut repeated `projectService: true` TypeScript bootstrap overhead (~5s /
 * ~1.15 GiB V8 heap per start) while staying conservatively within the 2048 MiB
 * `DEFAULT_MAX_OLD_SPACE_SIZE_MB` limit. Tune with `--block-size` or
 * `PAGES_LINT_BLOCK_SIZE` when benchmarking under runner limits.
 */
export const DEFAULT_BLOCK_SIZE = 600;

/**
 * Default V8 old-space heap limit (in MiB) passed via `--max-old-space-size`
 * to each sequential ESLint child process.
 */
export const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 2048;

/** Fixed sequential process concurrency (`1` ESLint child process at a time). */
export const LINT_PROCESS_CONCURRENCY = 1;

const MIN_BLOCK_SIZE = 1;
const MAX_BLOCK_SIZE = 5000;
const MIN_MAX_OLD_SPACE_SIZE_MB = 128;
const MAX_MAX_OLD_SPACE_SIZE_MB = 65536;
const MAX_CLI_ARG_CHARS = 120_000;

const OOM_PATTERNS = [
  /JavaScript heap out of memory/i,
  /Allocation failed - JavaScript heap out of memory/i,
  /Reached heap limit Allocation failed/i,
  /FatalProcessOutOfMemory/i,
];

function parsePositiveInteger(rawValue, settingName, sourceLabel, min, max) {
  const normalized = String(rawValue).trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(
      `Invalid ${settingName} from ${sourceLabel}: "${rawValue}". Expected a positive integer between ${min} and ${max}.`,
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Invalid ${settingName} from ${sourceLabel}: "${rawValue}". Expected a positive integer between ${min} and ${max}.`,
    );
  }
  return parsed;
}

const VALUE_FLAG_SPECS = [
  { flag: "--base", key: "diffBase", expected: "a Git reference" },
  { flag: "--block-size", key: "blockSize", expected: "a positive integer" },
  {
    flag: "--max-old-space-size",
    key: "maxOldSpaceSize",
    expected: "a positive integer in MiB",
  },
];

function matchValueFlag(argv, index) {
  const arg = argv[index];
  for (const spec of VALUE_FLAG_SPECS) {
    if (arg === spec.flag) {
      if (index + 1 >= argv.length) {
        throw new Error(
          `Missing value for CLI option "${spec.flag}". Expected ${spec.expected}.`,
        );
      }
      return { key: spec.key, value: argv[index + 1], nextIndex: index + 1 };
    }
    if (arg.startsWith(`${spec.flag}=`)) {
      return {
        key: spec.key,
        value: arg.slice(spec.flag.length + 1),
        nextIndex: index,
      };
    }
  }
  return null;
}

function parseCliArgs(argv) {
  const parsed = {
    blockSize: undefined,
    maxOldSpaceSize: undefined,
    changedOnly: false,
    diffBase: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--changed") {
      parsed.changedOnly = true;
      continue;
    }
    const matched = matchValueFlag(argv, index);
    if (matched) {
      parsed[matched.key] = matched.value;
      index = matched.nextIndex;
      continue;
    }
    throw new Error(
      `Unsupported lint argument "${arg}". Supported options: --block-size <int>, --max-old-space-size <int>, --changed, --base <ref>.`,
    );
  }

  if (parsed.diffBase !== null) {
    parsed.diffBase = parsed.diffBase.trim();
    if (!parsed.diffBase) {
      throw new Error(
        'Invalid value for CLI option "--base". Expected a non-empty Git reference.',
      );
    }
    if (!parsed.changedOnly) {
      throw new Error('CLI option "--base" requires "--changed".');
    }
  }

  return parsed;
}

function resolveIntOption(options) {
  if (options.cliValue !== undefined) {
    return {
      value: parsePositiveInteger(
        options.cliValue,
        options.settingName,
        `CLI ${options.cliFlag}`,
        options.min,
        options.max,
      ),
      source: `cli:${options.cliFlag}`,
    };
  }
  if (options.envValue !== undefined) {
    return {
      value: parsePositiveInteger(
        options.envValue,
        options.settingName,
        `env ${options.envName}`,
        options.min,
        options.max,
      ),
      source: `env:${options.envName}`,
    };
  }
  return { value: options.defaultValue, source: "default" };
}

/**
 * Parses and validates CLI and environment overrides for the sequential lint runner.
 * Precedence:
 * 1. CLI flags (`--block-size`, `--max-old-space-size`, `--changed`, `--base`)
 * 2. Environment variables (`PAGES_LINT_BLOCK_SIZE`, `PAGES_LINT_MAX_OLD_SPACE_SIZE`)
 * 3. Repository defaults (`DEFAULT_BLOCK_SIZE`, `DEFAULT_MAX_OLD_SPACE_SIZE_MB`)
 */
export function resolveLintConfig(argv, env) {
  const parsed = parseCliArgs(argv);
  const blockSize = resolveIntOption({
    cliValue: parsed.blockSize,
    envValue: env.PAGES_LINT_BLOCK_SIZE,
    defaultValue: DEFAULT_BLOCK_SIZE,
    settingName: "blockSize",
    cliFlag: "--block-size",
    envName: "PAGES_LINT_BLOCK_SIZE",
    min: MIN_BLOCK_SIZE,
    max: MAX_BLOCK_SIZE,
  });
  const maxOldSpaceSize = resolveIntOption({
    cliValue: parsed.maxOldSpaceSize,
    envValue: env.PAGES_LINT_MAX_OLD_SPACE_SIZE,
    defaultValue: DEFAULT_MAX_OLD_SPACE_SIZE_MB,
    settingName: "maxOldSpaceSizeMb",
    cliFlag: "--max-old-space-size",
    envName: "PAGES_LINT_MAX_OLD_SPACE_SIZE",
    min: MIN_MAX_OLD_SPACE_SIZE_MB,
    max: MAX_MAX_OLD_SPACE_SIZE_MB,
  });

  return {
    blockSize: blockSize.value,
    blockSizeSource: blockSize.source,
    maxOldSpaceSizeMb: maxOldSpaceSize.value,
    maxOldSpaceSizeSource: maxOldSpaceSize.source,
    concurrency: LINT_PROCESS_CONCURRENCY,
    changedOnly: parsed.changedOnly,
    diffBase: parsed.diffBase,
  };
}

/**
 * Lists every file of a lintable type below the root, independent of Git: what
 * Git ignores on one machine is no proof that a file is generated. Only
 * `source-population.mjs` and the `ignores` of `eslint.config.js` name generated
 * output, explicitly and for every checkout alike.
 */
export function collectCandidateFiles(rootDir) {
  return walkFiles(rootDir, isSourceFile);
}

const GIT_DIFF_NAME_ARGS = ["diff", "--name-only", "-z", "--diff-filter=ACMR"];

async function filterIgnoredFiles(rootDir, candidates) {
  if (candidates.length === 0) return [];
  const eslint = new ESLint({ cwd: rootDir });
  const selected = [];
  for (const relativePath of candidates) {
    const ignored = await eslint.isPathIgnored(
      path.resolve(rootDir, relativePath),
    );
    if (!ignored) selected.push(relativePath);
  }
  return selected;
}

/** The lint population: all candidates that `eslint.config.js` does not name as generated. */
export async function discoverLintFiles(rootDir) {
  return filterIgnoredFiles(rootDir, collectCandidateFiles(rootDir));
}

function runGitCommand(rootDir, args) {
  return spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
}

function splitNullSeparated(stdout) {
  return (stdout ?? "")
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.split(path.sep).join("/"));
}

function runGitPaths(rootDir, args, contextLabel) {
  const result = runGitCommand(rootDir, args);
  if (result.error) throw new Error(`${contextLabel}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      detail
        ? `${contextLabel}: ${detail}`
        : `${contextLabel} (exit ${result.status}).`,
    );
  }
  return splitNullSeparated(result.stdout);
}

function isInsideGeneratedDirectory(relativePath) {
  const parts = relativePath.split("/");
  let current = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current ? `${current}/${parts[index]}` : parts[index];
    if (isGeneratedDirectory(current)) return true;
  }
  return false;
}

function isExistingRegularSourceFile(rootDir, relativePath) {
  if (!isSourceFile(relativePath) || isInsideGeneratedDirectory(relativePath)) {
    return false;
  }
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!existsSync(absolutePath)) return false;
  try {
    const stats = lstatSync(absolutePath);
    return !stats.isSymbolicLink() && stats.isFile();
  } catch {
    return false;
  }
}

function collectBaseDiffPaths(rootDir, baseRef, hasHead) {
  const baseCheck = runGitCommand(rootDir, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseRef}^{commit}`,
  ]);
  if (baseCheck.error || baseCheck.status !== 0) {
    throw new Error(`Invalid Git base reference "${baseRef}" for --base.`);
  }
  if (!hasHead) {
    throw new Error(
      `Cannot diff against --base "${baseRef}" before an initial commit exists.`,
    );
  }
  const threeDot = runGitCommand(rootDir, [
    ...GIT_DIFF_NAME_ARGS,
    `${baseRef}...HEAD`,
  ]);
  if (!threeDot.error && threeDot.status === 0)
    return splitNullSeparated(threeDot.stdout);
  return runGitPaths(
    rootDir,
    [...GIT_DIFF_NAME_ARGS, baseRef, "HEAD"],
    `Git diff against --base "${baseRef}" failed`,
  );
}

function collectGitChangedPaths(rootDir, baseRef) {
  const workTreeCheck = runGitCommand(rootDir, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (
    workTreeCheck.error ||
    workTreeCheck.status !== 0 ||
    workTreeCheck.stdout.trim() !== "true"
  ) {
    throw new Error(
      "Changed-files lint mode (--changed) requires a Git working tree.",
    );
  }

  const headCheck = runGitCommand(rootDir, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    "HEAD",
  ]);
  const hasHead = !headCheck.error && headCheck.status === 0;
  const candidates = new Set();
  const addAll = (files) => {
    for (const file of files) candidates.add(file);
  };

  if (baseRef !== null) addAll(collectBaseDiffPaths(rootDir, baseRef, hasHead));
  if (hasHead) {
    addAll(
      runGitPaths(
        rootDir,
        [...GIT_DIFF_NAME_ARGS, "HEAD"],
        "Git diff against HEAD failed",
      ),
    );
  } else {
    addAll(
      runGitPaths(
        rootDir,
        [...GIT_DIFF_NAME_ARGS, "--cached"],
        "Git staged diff failed",
      ),
    );
    addAll(
      runGitPaths(rootDir, GIT_DIFF_NAME_ARGS, "Git working-tree diff failed"),
    );
  }
  addAll(
    runGitPaths(
      rootDir,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      "Git untracked-files listing failed",
    ),
  );

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

/**
 * Discovers changed lintable files for local pre-check (`--changed`),
 * including working-tree edits, staged changes, untracked files, and optional
 * committed branch changes against `baseRef`.
 */
export async function discoverChangedLintFiles(rootDir, baseRef = null) {
  const candidates = collectGitChangedPaths(rootDir, baseRef).filter(
    (relativePath) => isExistingRegularSourceFile(rootDir, relativePath),
  );
  return filterIgnoredFiles(rootDir, candidates);
}

/**
 * Splits discovered files into deterministic, disjoint blocks of at most
 * `blockSize` files, so a single ESLint child process loads the TypeScript
 * project (`tsconfig.json`) for a bounded number of files.
 */
export function buildLintBlocks(files, blockSize) {
  const blocks = [];
  for (let offset = 0; offset < files.length; offset += blockSize) {
    const slice = files.slice(offset, offset + blockSize);
    const argChars = slice.reduce((sum, item) => sum + item.length + 1, 0);
    if (argChars > MAX_CLI_ARG_CHARS) {
      throw new Error(
        `Block CLI arguments (${argChars} chars) exceed safe limit (${MAX_CLI_ARG_CHARS} chars); reduce --block-size.`,
      );
    }
    blocks.push({
      scope: "root",
      files: slice,
    });
  }

  return blocks.map((block, index) => ({
    index: index + 1,
    total: blocks.length,
    scope: block.scope,
    files: block.files,
  }));
}

function hasOutOfMemoryIndicator(text) {
  return OOM_PATTERNS.some((pattern) => pattern.test(text));
}

function stripInjectedMaxOldSpaceSize(nodeOptions) {
  if (!nodeOptions) return "";
  return nodeOptions.replace(/--max-old-space-size(?:=\S+|\s+\S+)/g, "").trim();
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const eslintBin = path.join(
    repoRoot,
    "node_modules",
    "eslint",
    "bin",
    "eslint.js",
  );

  let config;
  try {
    config = resolveLintConfig(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(
      `[lint] Configuration error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
    return;
  }

  if (!existsSync(eslintBin)) {
    console.error(
      `[lint] Fatal error: ESLint binary not found at ${eslintBin}.`,
    );
    process.exitCode = 2;
    return;
  }

  let files;
  try {
    files = config.changedOnly
      ? await discoverChangedLintFiles(repoRoot, config.diffBase)
      : await discoverLintFiles(repoRoot);
  } catch (error) {
    console.error(
      `[lint] Fatal error during file discovery: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
    return;
  }

  if (files.length === 0) {
    if (config.changedOnly) {
      const scopeHint = config.diffBase
        ? ` (base=${config.diffBase})`
        : " (working tree + index; pass --base <ref> to include committed branch changes)";
      console.info(
        `[lint] PASSED (changed mode): 0 changed lintable files${scopeHint}.`,
      );
      process.exitCode = 0;
      return;
    }
    console.error(
      "[lint] Fatal error: No lintable files were discovered. Refusing to treat an empty selection as success.",
    );
    process.exitCode = 2;
    return;
  }

  let blocks;
  try {
    blocks = buildLintBlocks(files, config.blockSize);
  } catch (error) {
    console.error(
      `[lint] Fatal error while building blocks: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
    return;
  }

  const assignedCount = blocks.reduce(
    (sum, block) => sum + block.files.length,
    0,
  );
  if (assignedCount !== files.length) {
    console.error(
      `[lint] Fatal internal error: assigned ${assignedCount} files across blocks, expected ${files.length}.`,
    );
    process.exitCode = 2;
    return;
  }

  const modeLabel = config.changedOnly
    ? `changed-files lint${config.diffBase ? ` (base=${config.diffBase})` : ""}`
    : "sequential block lint";
  console.info(
    `[lint] Starting ${modeLabel}: ${files.length} files in ${blocks.length} blocks (blockSize=${config.blockSize} [${config.blockSizeSource}], maxOldSpaceSizeMb=${config.maxOldSpaceSizeMb} [${config.maxOldSpaceSizeSource}], concurrency=${config.concurrency}).`,
  );

  let activeChild = null;
  let abortSignal = null;

  const handleSignal = (signal) => {
    if (!abortSignal) {
      abortSignal = signal;
      console.error(
        `[lint] Received ${signal}; forwarding to active ESLint child process and stopping further blocks...`,
      );
    }
    if (activeChild && activeChild.exitCode === null && !activeChild.killed) {
      try {
        activeChild.kill(signal);
      } catch {
        // Child already exited.
      }
    }
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  const startedAt = Date.now();
  let checkedFiles = 0;
  let completedBlocks = 0;
  const lintFailedBlocks = [];
  let fatalFailure = null;

  try {
    for (const block of blocks) {
      if (abortSignal) {
        fatalFailure = {
          kind: "signal",
          block,
          detail: `Aborted by ${abortSignal} before starting block ${block.index}/${block.total}.`,
          exitCode: abortSignal === "SIGINT" ? 130 : 143,
        };
        break;
      }

      const blockStart = Date.now();
      const firstFile = block.files[0];
      const lastFile = block.files[block.files.length - 1];
      console.info(
        `[lint] Block ${block.index}/${block.total} (${block.scope}, ${block.files.length} files: ${firstFile} .. ${lastFile})`,
      );

      const childEnv = { ...process.env };
      const cleanedNodeOptions = stripInjectedMaxOldSpaceSize(
        childEnv.NODE_OPTIONS,
      );
      if (cleanedNodeOptions) {
        childEnv.NODE_OPTIONS = cleanedNodeOptions;
      } else {
        delete childEnv.NODE_OPTIONS;
      }

      const outcome = await new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [
            `--max-old-space-size=${config.maxOldSpaceSizeMb}`,
            eslintBin,
            "--concurrency=off",
            "--max-warnings=0",
            "--",
            ...block.files,
          ],
          {
            cwd: repoRoot,
            env: childEnv,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
          },
        );
        activeChild = child;

        const stdoutChunks = [];
        const stderrChunks = [];

        child.stdout.on("data", (chunk) => {
          stdoutChunks.push(chunk);
          process.stdout.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderrChunks.push(chunk);
          process.stderr.write(chunk);
        });

        const finish = (code, signal, spawnError) => {
          activeChild = null;
          resolve({
            code,
            signal,
            spawnError,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
          });
        };
        child.once("error", (error) => finish(null, null, error));
        child.once("close", (code, signal) => finish(code, signal, null));
      });

      const elapsedSeconds = ((Date.now() - blockStart) / 1000).toFixed(1);
      const combinedOutput = `${outcome.stdout}\n${outcome.stderr}`;
      const isOom = hasOutOfMemoryIndicator(combinedOutput);

      if (outcome.spawnError) {
        fatalFailure = {
          kind: "spawn",
          block,
          detail: `Failed to spawn ESLint process: ${outcome.spawnError.message}`,
          exitCode: 2,
        };
        break;
      }

      if (abortSignal || outcome.signal) {
        const sig = abortSignal ?? outcome.signal;
        fatalFailure = {
          kind: isOom ? "oom" : "signal",
          block,
          detail: isOom
            ? `ESLint child process exceeded memory limit (${config.maxOldSpaceSizeMb} MiB) in block ${block.index}/${block.total} (signal ${sig}).`
            : `ESLint child process terminated by signal ${sig} in block ${block.index}/${block.total} after ${elapsedSeconds}s.`,
          exitCode: sig === "SIGINT" ? 130 : sig === "SIGTERM" ? 143 : 2,
        };
        break;
      }

      if (isOom) {
        fatalFailure = {
          kind: "oom",
          block,
          detail: `ESLint child process ran out of memory (${config.maxOldSpaceSizeMb} MiB limit) in block ${block.index}/${block.total} after ${elapsedSeconds}s.`,
          exitCode: 2,
        };
        break;
      }

      if (outcome.code === 0) {
        checkedFiles += block.files.length;
        completedBlocks += 1;
        console.info(
          `[lint] Block ${block.index}/${block.total} passed (${block.files.length} files, ${elapsedSeconds}s; ${checkedFiles}/${files.length} checked).`,
        );
        continue;
      }

      if (outcome.code === 1) {
        checkedFiles += block.files.length;
        completedBlocks += 1;
        lintFailedBlocks.push(block.index);
        console.error(
          `[lint] Block ${block.index}/${block.total} reported lint findings (${block.files.length} files, ${elapsedSeconds}s; ${checkedFiles}/${files.length} checked).`,
        );
        continue;
      }

      fatalFailure = {
        kind: "fatal_exit",
        block,
        detail: `ESLint exited with fatal/configuration code ${outcome.code} in block ${block.index}/${block.total} after ${elapsedSeconds}s.`,
        exitCode:
          typeof outcome.code === "number" && outcome.code > 1
            ? outcome.code
            : 2,
      };
      break;
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }

  const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const uncheckedFiles = files.length - checkedFiles;

  if (fatalFailure) {
    console.error(
      `[lint] ABORTED (${fatalFailure.kind}): ${fatalFailure.detail} Summary: ${completedBlocks}/${blocks.length} blocks completed, ${checkedFiles}/${files.length} files checked, ${uncheckedFiles} files unchecked (${totalSeconds}s).`,
    );
    process.exitCode = fatalFailure.exitCode;
    return;
  }

  if (lintFailedBlocks.length > 0) {
    console.error(
      `[lint] FAILED: Lint findings in ${lintFailedBlocks.length}/${blocks.length} blocks (blocks: ${lintFailedBlocks.join(", ")}). Summary: ${checkedFiles}/${files.length} files checked, ${uncheckedFiles} files unchecked (${totalSeconds}s).`,
    );
    process.exitCode = 1;
    return;
  }

  const modeSuffix = config.changedOnly ? " (changed mode)" : "";
  console.info(
    `[lint] PASSED${modeSuffix}: ${checkedFiles}/${files.length} files checked across ${completedBlocks}/${blocks.length} sequential blocks with 0 warnings and 0 errors (${totalSeconds}s).`,
  );
  process.exitCode = 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
