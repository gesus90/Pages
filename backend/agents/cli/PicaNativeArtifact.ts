import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

/** The runners whose native build carries the Pages-only tool surface. */
export type PicaNativeRunner = "codex" | "opencode";

/** A verified, read-only native runner build selected for one Pica session. */
export interface PicaNativeArtifact {
  readonly runner: PicaNativeRunner;
  readonly directory: string;
  readonly executable: string;
}

interface RunnerPin {
  readonly version: string;
  readonly commit: string;
  readonly patchPath: string;
  readonly patchSha256: string;
  readonly capability: string;
  readonly lockSha256: string;
}

interface FileFact {
  readonly bytes: number;
  readonly sha256: string;
  readonly mode: string;
}

// These mirror PINS in scripts/pica-native-build/build.py; a changed patch or
// pin there needs the same change here, so an old build is never selected.
const PINS: Readonly<Record<PicaNativeRunner, RunnerPin>> = {
  codex: {
    version: "0.160.0",
    commit: "a956835d020762cb2b570053af06f643a11c0ecc",
    patchPath: "backend/agents/codex-patch/pages-tool-policy.patch",
    patchSha256:
      "ae87b482ce96ae23b2b89499bb285de870bd90888d964e8db4a53489a398a588",
    capability: "pica-tool-policy-candidate",
    lockSha256:
      "5553f06583159ed64666b6eb4beea3154e06b612e6312528131bdc226a6a860c",
  },
  opencode: {
    version: "1.18.34",
    commit: "aec0b9a6d8898f68f923aaf08b7306d931fd9d76",
    patchPath: "backend/agents/opencode-patch/pages-pica.patch",
    patchSha256:
      "aeb4124998396098f19fd3b5016e59cfe7d85e9acf7b2d655e43bfa612a16f3d",
    capability: "pica-native-tools-candidate",
    lockSha256:
      "04483150cfabd37bedae4055036cd7a665e3471053adad343cb1ccfbbca6c79c",
  },
};

const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_FILES = 4096;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;
const HASH_BLOCK_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;

// A verified build is hashed once; a changed inode, size or time hashes it again.
const verifiedBuilds = new Map<string, string>();

function refuse(): never {
  throw new AgentError("pica_native_artifact_unavailable");
}

function asRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

function modeOf(facts: { readonly mode: number }): string {
  return (facts.mode & 0o7777).toString(8).padStart(4, "0");
}

function requireOwnedEntry(facts: {
  readonly uid: number;
  readonly mode: number;
}): void {
  if (facts.uid !== process.getuid?.() || (facts.mode & 0o022) !== 0) refuse();
}

function hashFile(file: string): { sha256: string; bytes: number } {
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const facts = fstatSync(handle);
    if (!facts.isFile() || facts.size > MAXIMUM_FILE_BYTES) refuse();
    requireOwnedEntry(facts);
    const hash = createHash("sha256");
    const block = Buffer.alloc(HASH_BLOCK_BYTES);
    for (;;) {
      const count = readSync(handle, block, 0, block.length, null);
      if (count === 0) break;
      hash.update(block.subarray(0, count));
    }
    return { sha256: hash.digest("hex"), bytes: facts.size };
  } finally {
    closeSync(handle);
  }
}

function readManifest(directory: string): {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly sha256: string;
} {
  const file = path.join(directory, "manifest.json");
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const facts = fstatSync(handle);
    if (
      !facts.isFile() ||
      facts.size < 2 ||
      facts.size > MAXIMUM_MANIFEST_BYTES
    )
      refuse();
    requireOwnedEntry(facts);
    const bytes = Buffer.alloc(facts.size);
    if (readSync(handle, bytes, 0, bytes.length, 0) !== bytes.length) refuse();
    const manifest = asRecord(JSON.parse(bytes.toString("utf8")));
    if (!manifest) refuse();
    return {
      manifest,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    closeSync(handle);
  }
}

function requirePatch(
  manifest: Readonly<Record<string, unknown>>,
  pin: RunnerPin,
): void {
  const patches = manifest.patches;
  const first = Array.isArray(patches) ? asRecord(patches[0]) : null;
  if (
    first?.path !== pin.patchPath ||
    first.sha256 !== pin.patchSha256 ||
    !Array.isArray(patches) ||
    patches.length > 2
  )
    refuse();
}

function requireIdentity(
  manifest: Readonly<Record<string, unknown>>,
  runner: PicaNativeRunner,
): void {
  const pin = PINS[runner];
  const upstream = asRecord(manifest.upstream);
  const target = asRecord(manifest.target);
  const capabilities = manifest.capabilities;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== "built-unverified" ||
    manifest.runner !== runner ||
    manifest.expectedVersion !== pin.version ||
    manifest.lockSha256 !== pin.lockSha256 ||
    upstream?.version !== pin.version ||
    upstream.commit !== pin.commit ||
    target?.os !== "linux" ||
    target.abi !== "glibc" ||
    !Array.isArray(capabilities) ||
    capabilities.length !== 1 ||
    capabilities[0] !== pin.capability
  )
    refuse();
  requirePatch(manifest, pin);
}

function declaredFiles(
  manifest: Readonly<Record<string, unknown>>,
  runner: PicaNativeRunner,
): ReadonlyMap<string, FileFact> {
  const files = asRecord(manifest.files);
  if (!files || !(runner in files) || !("LICENSE" in files)) refuse();
  const entries = Object.entries(files);
  if (entries.length > MAXIMUM_FILES) refuse();
  const declared = new Map<string, FileFact>();
  for (const [name, value] of entries) {
    const fact = asRecord(value);
    if (
      !fact ||
      typeof fact.bytes !== "number" ||
      !Number.isSafeInteger(fact.bytes) ||
      typeof fact.sha256 !== "string" ||
      !SHA256.test(fact.sha256) ||
      typeof fact.mode !== "string" ||
      !/^0[0-7]{3}$/u.test(fact.mode)
    )
      refuse();
    declared.set(name, {
      bytes: fact.bytes,
      sha256: fact.sha256,
      mode: fact.mode,
    });
  }
  return declared;
}

function listFiles(directory: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      found.push(...listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
    else refuse();
    if (found.length > MAXIMUM_FILES) refuse();
  }
  return found;
}

function requirePrivateDirectory(directory: string): void {
  const facts = lstatSync(directory);
  if (!facts.isDirectory()) refuse();
  requireOwnedEntry(facts);
}

function verifyFiles(
  directory: string,
  declared: ReadonlyMap<string, FileFact>,
): void {
  const present = listFiles(directory).filter(
    (name) => name !== "manifest.json",
  );
  if (
    present.length !== declared.size ||
    present.some((name) => !declared.has(name))
  )
    refuse();
  for (const [name, fact] of declared) {
    const file = path.join(directory, name);
    requirePrivateDirectory(path.dirname(file));
    const actual = hashFile(file);
    const facts = lstatSync(file);
    if (
      actual.sha256 !== fact.sha256 ||
      actual.bytes !== fact.bytes ||
      modeOf(facts) !== fact.mode
    )
      refuse();
  }
}

function signature(directory: string, runner: PicaNativeRunner): string {
  const facts = lstatSync(path.join(directory, runner));
  return `${facts.dev}:${facts.ino}:${facts.size}:${facts.mtimeMs}:${facts.ctimeMs}`;
}

/**
 * Verifies a native runner build against the pinned patch, version and file hashes.
 *
 * @param directory - The installed build, with its `manifest.json` and files.
 * @param runner - The runner the build must belong to.
 * @returns The build with the path of its executable.
 * @throws {AgentError} `pica_native_artifact_unavailable` for a missing,
 * changed, foreign or differently pinned build.
 *
 * @remarks
 * The manifest says `built-unverified` because the builder only records what
 * went in. Pages accepts a build only when every recorded hash and mode still
 * matches. That the running core really enforces the Pages-only tool surface
 * is checked again at each session start by the native handshake.
 */
export function verifyPicaNativeArtifact(
  directory: string,
  runner: PicaNativeRunner,
): PicaNativeArtifact {
  try {
    if (realpathSync(directory) !== directory) refuse();
    requirePrivateDirectory(directory);
    const { manifest, sha256 } = readManifest(directory);
    requireIdentity(manifest, runner);
    const key = `${directory}:${sha256}`;
    const current = signature(directory, runner);
    if (verifiedBuilds.get(key) !== current) {
      verifyFiles(directory, declaredFiles(manifest, runner));
      verifiedBuilds.set(key, current);
    }
    return { runner, directory, executable: path.join(directory, runner) };
  } catch (error: unknown) {
    if (error instanceof AgentError) throw error;
    return refuse();
  }
}

/**
 * Selects the installed native build of a runner below the instance tools folder.
 *
 * @param toolsDirectory - The instance-local tools folder, mounted read-only into sessions.
 * @param runner - The runner to select.
 * @returns The verified build.
 * @throws {AgentError} `pica_native_artifact_unavailable` without a usable build.
 */
export function requirePicaNativeArtifact(
  toolsDirectory: string | undefined,
  runner: PicaNativeRunner,
): PicaNativeArtifact {
  if (toolsDirectory === undefined) return refuse();
  return verifyPicaNativeArtifact(
    path.join(toolsDirectory, "pica-native", runner),
    runner,
  );
}
