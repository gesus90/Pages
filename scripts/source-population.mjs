import { readdirSync } from "node:fs";
import path from "node:path";

/** Generated at any depth, as named in `eslint.config.js`. */
const GENERATED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
]);

/**
 * Generated or independent only directly below the root: `mobile/` is the
 * independent app, while `backend/service/mobile/` is source of Pages.
 */
const GENERATED_ROOT_DIRECTORIES = new Set([
  "build",
  ".react-router",
  "mobile",
]);

/** File types that are source wherever they lie, ignored by Git or not. */
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
]);

/** Root directories of local runtime state; only source files in them count. */
const RUNTIME_ROOT_DIRECTORIES = new Set([
  "data",
  "Results",
  ".claude",
  "tests/browser/results",
]);

/** Whether a directory, relative to the root, holds only generated output. */
export function isGeneratedDirectory(relativePath) {
  const name = path.posix.basename(relativePath);
  return (
    GENERATED_DIRECTORY_NAMES.has(name) ||
    (!relativePath.includes("/") && GENERATED_ROOT_DIRECTORIES.has(name))
  );
}

/** Whether a file is of a type that is linted as source. */
export function isSourceFile(relativePath) {
  return SOURCE_EXTENSIONS.has(path.posix.extname(relativePath));
}

/** Local state: secrets, logs and runtime files, none of which is ever published. */
function isLocalState(relativePath) {
  const name = path.posix.basename(relativePath);
  if (name.endsWith(".log")) return true;
  if (
    (name === ".env" || name.startsWith(".env.")) &&
    name !== ".env.example"
  ) {
    return true;
  }
  for (const directory of RUNTIME_ROOT_DIRECTORIES) {
    if (relativePath.startsWith(`${directory}/`)) {
      return !isSourceFile(relativePath);
    }
  }
  return false;
}

/**
 * Whether a file belongs to the source fingerprint.
 *
 * @remarks
 * The rule is an explicit classification and does not ask Git: a source file
 * that a `.gitignore` or a local exclude happens to match still counts, so no
 * source can change unnoticed behind an ignore rule.
 */
export function isFingerprintedFile(relativePath) {
  return (
    !isLocalState(relativePath) &&
    !relativePath.startsWith("tests/browser/results/")
  );
}

/**
 * Lists the files below a root without Git, sorted and with `/` separators.
 * Generated directories and symbolic links are left out.
 *
 * @param rootDir - The directory to walk.
 * @param accept - Decides over each file by its path relative to the root.
 */
export function walkFiles(rootDir, accept) {
  const files = [];

  function walk(currentDir, relativeDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!isGeneratedDirectory(relativePath)) {
          walk(path.join(currentDir, entry.name), relativePath);
        }
      } else if (entry.isFile() && accept(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  walk(rootDir, "");
  return files.sort((left, right) => left.localeCompare(right));
}
