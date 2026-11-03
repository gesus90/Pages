import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

import { isSourceFile, walkFiles } from "./source-population.mjs";

/**
 * Default maximum number of files checked per sequential ESLint process.
 *
 * Chosen from repository measurements (~3,520 linted files across root
 * `tsconfig.json` and `mcp/tsconfig.json`): `projectService: true` has a fixed
 * ~5s / ~1.15 GiB V8-heap (~1.45 GiB RSS) bootstrap per TypeScript project.
 * Blocks of at most 200 files within one package boundary keep per-process peak
 * V8 heap around ~1.35-1.50 GiB and peak RSS around ~1.65-1.75 GiB while
 * releasing the TypeScript project context after every block.
 */
export const DEFAULT_BLOCK_SIZE = 200;

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

/**
 * Parses and validates CLI and environment overrides for the sequential lint runner.
 *
 * Precedence:
 * 1. CLI flags (`--block-size`, `--max-old-space-size`)
 * 2. Environment variables (`PAGES_LINT_BLOCK_SIZE`, `PAGES_LINT_MAX_OLD_SPACE_SIZE`)
 * 3. Repository defaults (`DEFAULT_BLOCK_SIZE`, `DEFAULT_MAX_OLD_SPACE_SIZE_MB`)
 */
export function resolveLintConfig(argv, env) {
  let cliBlockSize;
  let cliMaxOldSpaceSize;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--block-size") {
      if (index + 1 >= argv.length) {
        throw new Error(
          'Missing value for CLI option "--block-size". Expected a positive integer.',
        );
      }
      cliBlockSize = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--block-size=")) {
      cliBlockSize = arg.slice("--block-size=".length);
      continue;
    }
    if (arg === "--max-old-space-size") {
      if (index + 1 >= argv.length) {
        throw new Error(
          'Missing value for CLI option "--max-old-space-size". Expected a positive integer in MiB.',
        );
      }
      cliMaxOldSpaceSize = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-old-space-size=")) {
      cliMaxOldSpaceSize = arg.slice("--max-old-space-size=".length);
      continue;
    }
    throw new Error(
      `Unsupported lint argument "${arg}". Supported options: --block-size <int>, --max-old-space-size <int>.`,
    );
  }

  let blockSize = DEFAULT_BLOCK_SIZE;
  let blockSizeSource = "default";
  if (cliBlockSize !== undefined) {
    blockSize = parsePositiveInteger(
      cliBlockSize,
      "blockSize",
      "CLI --block-size",
      MIN_BLOCK_SIZE,
      MAX_BLOCK_SIZE,
    );
    blockSizeSource = "cli:--block-size";
  } else if (env.PAGES_LINT_BLOCK_SIZE !== undefined) {
    blockSize = parsePositiveInteger(
      env.PAGES_LINT_BLOCK_SIZE,
      "blockSize",
      "env PAGES_LINT_BLOCK_SIZE",
      MIN_BLOCK_SIZE,
      MAX_BLOCK_SIZE,
    );
    blockSizeSource = "env:PAGES_LINT_BLOCK_SIZE";
  }

  let maxOldSpaceSizeMb = DEFAULT_MAX_OLD_SPACE_SIZE_MB;
  let maxOldSpaceSizeSource = "default";
  if (cliMaxOldSpaceSize !== undefined) {
    maxOldSpaceSizeMb = parsePositiveInteger(
      cliMaxOldSpaceSize,
      "maxOldSpaceSizeMb",
      "CLI --max-old-space-size",
      MIN_MAX_OLD_SPACE_SIZE_MB,
      MAX_MAX_OLD_SPACE_SIZE_MB,
    );
    maxOldSpaceSizeSource = "cli:--max-old-space-size";
  } else if (env.PAGES_LINT_MAX_OLD_SPACE_SIZE !== undefined) {
    maxOldSpaceSizeMb = parsePositiveInteger(
      env.PAGES_LINT_MAX_OLD_SPACE_SIZE,
      "maxOldSpaceSizeMb",
      "env PAGES_LINT_MAX_OLD_SPACE_SIZE",
      MIN_MAX_OLD_SPACE_SIZE_MB,
      MAX_MAX_OLD_SPACE_SIZE_MB,
    );
    maxOldSpaceSizeSource = "env:PAGES_LINT_MAX_OLD_SPACE_SIZE";
  }

  return {
    blockSize,
    blockSizeSource,
    maxOldSpaceSizeMb,
    maxOldSpaceSizeSource,
    concurrency: LINT_PROCESS_CONCURRENCY,
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

/** The lint population: all candidates that `eslint.config.js` does not name as generated. */
export async function discoverLintFiles(rootDir) {
  const candidates = collectCandidateFiles(rootDir);
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

/**
 * Splits discovered files into deterministic, disjoint blocks of at most
 * `blockSize` files while keeping `mcp/**` (`mcp/tsconfig.json`) and root
 * project files (`tsconfig.json`) in separate blocks so a single ESLint child
 * process never loads both TypeScript programs simultaneously.
 */
export function buildLintBlocks(files, blockSize) {
  const rootScopeFiles = [];
  const mcpScopeFiles = [];

  for (const file of files) {
    if (file.startsWith("mcp/")) {
      mcpScopeFiles.push(file);
    } else {
      rootScopeFiles.push(file);
    }
  }

  const blocks = [];
  for (const [scope, scopeFiles] of [
    ["root", rootScopeFiles],
    ["mcp", mcpScopeFiles],
  ]) {
    for (let offset = 0; offset < scopeFiles.length; offset += blockSize) {
      const slice = scopeFiles.slice(offset, offset + blockSize);
      const argChars = slice.reduce((sum, item) => sum + item.length + 1, 0);
      if (argChars > MAX_CLI_ARG_CHARS) {
        throw new Error(
          `Block CLI arguments (${argChars} chars) exceed safe limit (${MAX_CLI_ARG_CHARS} chars); reduce --block-size.`,
        );
      }
      blocks.push({
        scope,
        files: slice,
      });
    }
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
    files = await discoverLintFiles(repoRoot);
  } catch (error) {
    console.error(
      `[lint] Fatal error during file discovery: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
    return;
  }

  if (files.length === 0) {
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

  console.info(
    `[lint] Starting sequential block lint: ${files.length} files in ${blocks.length} blocks (blockSize=${config.blockSize} [${config.blockSizeSource}], maxOldSpaceSizeMb=${config.maxOldSpaceSizeMb} [${config.maxOldSpaceSizeSource}], concurrency=${config.concurrency}).`,
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

        child.once("error", (error) => {
          activeChild = null;
          resolve({
            code: null,
            signal: null,
            spawnError: error,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
          });
        });

        child.once("close", (code, signal) => {
          activeChild = null;
          resolve({
            code,
            signal,
            spawnError: null,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
          });
        });
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

  console.info(
    `[lint] PASSED: ${checkedFiles}/${files.length} files checked across ${completedBlocks}/${blocks.length} sequential blocks with 0 warnings and 0 errors (${totalSeconds}s).`,
  );
  process.exitCode = 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
