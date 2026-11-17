import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withCommandTemporaryDirectory } from "./command-temporary-directory.mjs";
import { runStep } from "./command-step.mjs";
import { describeExitCode, runQaGate, verifyQaEvidence } from "./qa-gate.mjs";

import { isFingerprintedFile, walkFiles } from "./source-population.mjs";

/** Exit code of a command that was called in an unsupported way. */
const USAGE_EXIT_CODE = 2;

/** Files of a repository manifest that must never count as source. */
const TICKET_ASSET_PREFIX = ".pages-assets-";

/** Package directories with their own lockfile and modules. */
const PACKAGES = { pages: "." };

/**
 * Builds the sorted manifest and its SHA-256.
 * @param files - Repository-relative paths, in any order.
 * @param readHash - The SHA-256 of a file, or `null` for a deleted one.
 * @param runtime - Facts outside the files, such as the installed lockfile.
 */
export function buildManifest(files, readHash, runtime) {
  const sorted = [...new Set(files)]
    .filter((file) => !path.basename(file).startsWith(TICKET_ASSET_PREFIX))
    .sort();
  const lines = [
    ...sorted.map((file) => `${file}\0${readHash(file) ?? "DELETED"}`),
    ...Object.entries(runtime)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `@${name}\0${value}`),
  ];
  const manifest = `${lines.join("\n")}\n`;
  return {
    fingerprint: createHash("sha256").update(manifest).digest("hex"),
    manifest,
    fileCount: sorted.length,
  };
}

/**
 * Compares the installed modules of a package with its lockfile.
 *
 * @returns Why the modules cannot serve a gate; empty when they can.
 */
export function inspectDependencies(input) {
  if (input.lockfile === null) return ["lockfile_missing"];
  if (input.installedLockfile === null) return ["modules_missing"];
  const issues = [];
  if (input.installedLockfile !== input.lockfile) issues.push("lockfile_stale");
  if (input.state?.settings?.enableGlobalVirtualStore !== false) {
    issues.push("modules_layout_stale");
  }
  return issues;
}

function readOptional(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function readJsonOptional(file) {
  const text = readOptional(file);
  return text === null ? null : JSON.parse(text);
}

function dependencyIssues(root, directory) {
  const base = path.join(root, directory);
  return inspectDependencies({
    lockfile: readOptional(path.join(base, "pnpm-lock.yaml")),
    installedLockfile: readOptional(
      path.join(base, "node_modules/.pnpm/lock.yaml"),
    ),
    state: readJsonOptional(
      path.join(base, "node_modules/.pnpm-workspace-state-v1.json"),
    ),
  });
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function installedLockHash(root, scope) {
  const file = path.join(root, PACKAGES[scope], "node_modules/.pnpm/lock.yaml");
  return existsSync(file) ? sha256File(file) : "missing";
}

function gitTrackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.split("\0").filter(Boolean) : [];
}

/**
 * Lists the files of a checkout by the explicit classification, independent of
 * ignore rules. Git only adds what the walk cannot know: tracked files, which
 * count even when an ignore rule matches them, and tracked files that were deleted.
 */
function listRepositoryFiles(root, listTracked) {
  return [
    ...new Set([...walkFiles(root, isFingerprintedFile), ...listTracked(root)]),
  ];
}

/**
 * The manifest of a checkout now.
 *
 * @param root - The checkout.
 * @param scope - `pages`.
 * @param listTracked - The tracked files; a checkout without Git has none.
 */
export function currentManifest(root, scope, listTracked = gitTrackedFiles) {
  return buildManifest(
    listRepositoryFiles(root, listTracked),
    (file) => {
      const absolute = path.join(root, file);
      return existsSync(absolute) ? sha256File(absolute) : null;
    },
    {
      installedLockfile: installedLockHash(root, scope),
      node: process.version,
    },
  );
}

function fingerprintCommand(root, scope, manifestFile) {
  const result = currentManifest(root, scope);
  if (manifestFile) writeFileSync(manifestFile, result.manifest);
  console.info(
    JSON.stringify({
      scope,
      fingerprint: result.fingerprint,
      fileCount: result.fileCount,
    }),
  );
  return 0;
}

async function preflightCommand(root, scope, shouldInstall, signal) {
  const directory = PACKAGES[scope];
  let issues = dependencyIssues(root, directory);
  if (issues.length > 0 && shouldInstall) {
    // `CI` allows the purge of stale modules without a terminal; the frozen
    // lockfile keeps the installed versions exactly the reviewed ones.
    const code = await runStep(
      "pnpm",
      ["--dir", directory, "install", "--frozen-lockfile"],
      {
        cwd: root,
        env: {
          ...process.env,
          CI: "true",
          pnpm_config_enable_global_virtual_store: "false",
        },
        timeoutMilliseconds: 30 * 60_000,
        signal,
      },
    );
    if (code !== 0) {
      console.error(
        `[qa] FAILED: install of ${scope} ended with ${describeExitCode(code)}.`,
      );
      return code;
    }
    issues = dependencyIssues(root, directory);
  }
  console.info(JSON.stringify({ scope, node: process.version, issues }));
  return issues.length === 0 ? 0 : 1;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args, signal) {
  signal.throwIfAborted();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command] = args;
  const scope = readOption(args, "--scope");
  if (!Object.hasOwn(PACKAGES, scope ?? "")) {
    console.error(
      "Usage: qa-evidence.mjs preflight --scope pages [--install] | fingerprint --scope pages [--manifest <file>] | gate --scope pages [--evidence <file>] [--previous <file>] | verify --scope pages --evidence <file>",
    );
    return USAGE_EXIT_CODE;
  }
  if (command === "preflight") {
    return preflightCommand(root, scope, args.includes("--install"), signal);
  }
  if (command === "fingerprint") {
    return fingerprintCommand(root, scope, readOption(args, "--manifest"));
  }
  if (command === "gate") {
    return runQaGate({
      root,
      evidenceFile: readOption(args, "--evidence"),
      previousFile: readOption(args, "--previous"),
      signal,
    });
  }
  if (command === "verify" && readOption(args, "--evidence")) {
    return verifyQaEvidence(root, readOption(args, "--evidence"));
  }
  console.error(`Unknown command: ${command}`);
  return USAGE_EXIT_CODE;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await withCommandTemporaryDirectory(({ signal }) =>
      main(process.argv.slice(2), signal),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = process.exitCode || 1;
  }
}
