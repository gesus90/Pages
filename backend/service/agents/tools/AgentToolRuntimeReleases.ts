import {
  compareStableVersions,
  readStableVersion,
} from "@/definition/AgentToolVersion";

import type { StableVersion } from "@/definition/AgentToolVersion";
import type { AgentToolRelease } from "./AgentToolContracts";
import type {
  AgentToolNodeSource,
  AgentToolPythonSource,
} from "./AgentToolRegistry";

const NODE_DISTRIBUTION = "https://nodejs.org/dist";
const GITHUB_API = "https://api.github.com";
// A release of the Python builds lists about a thousand archives.
const PYTHON_RELEASE_LIMIT = 16 * 1024 * 1024;
const PYTHON_RELEASE_PAGE = 5;
const NODE_INDEX_LIMIT = 4 * 1024 * 1024;

/** A source could not be reached, which is not the same as having no update. */
export class ReleaseSourceUnreachableError extends Error {}

/** The source answered with metadata Pages does not accept. */
export class ReleaseMetadataError extends Error {}

/** The source names a pre-release, another non-stable version or none in the reviewed line. */
export class ReleaseIncompatibleError extends Error {}

/** Reads the body of one fixed metadata URL within a size limit. */
export type ReleaseMetadataRead = (
  url: string,
  headers: Readonly<Record<string, string>>,
  limit: number,
) => Promise<string>;

interface VersionedEntry<Entry> {
  readonly version: string;
  readonly parsed: StableVersion;
  readonly entry: Entry;
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function text(input: Record<string, unknown>, key: string): string | null {
  const field = input[key];
  return typeof field === "string" ? field : null;
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new ReleaseMetadataError();
  }
}

// The newest entry, or the one with exactly the requested version.
function choose<Entry>(
  entries: readonly VersionedEntry<Entry>[],
  version: string | null,
): VersionedEntry<Entry> {
  const chosen =
    version === null
      ? [...entries]
          .sort((left, right) =>
            compareStableVersions(right.parsed, left.parsed),
          )
          .at(0)
      : entries.find((entry) => entry.version === version);
  if (chosen) return chosen;
  throw version === null
    ? new ReleaseIncompatibleError()
    : new ReleaseMetadataError();
}

function nodePlatform(): string {
  if (process.platform !== "linux") throw new ReleaseMetadataError();
  if (process.arch === "x64") return "linux-x64";
  if (process.arch === "arm64") return "linux-arm64";
  throw new ReleaseMetadataError();
}

function pythonTriple(): string {
  if (process.platform !== "linux") throw new ReleaseMetadataError();
  if (process.arch === "x64") return "x86_64-unknown-linux-gnu";
  if (process.arch === "arm64") return "aarch64-unknown-linux-gnu";
  throw new ReleaseMetadataError();
}

function nodeEntries(
  index: unknown,
  source: AgentToolNodeSource,
  platform: string,
): readonly VersionedEntry<string>[] {
  if (!Array.isArray(index)) throw new ReleaseMetadataError();
  const entries: VersionedEntry<string>[] = [];
  for (const item of index) {
    if (!record(item)) continue;
    const tag = text(item, "version");
    const parsed =
      tag && /^v\d+\.\d+\.\d+$/u.test(tag) ? readStableVersion(tag) : null;
    const files = Array.isArray(item.files) ? item.files : [];
    if (!tag || !parsed || parsed[0] !== source.major) continue;
    if (!files.includes(platform)) continue;
    entries.push({ version: tag.slice(1), parsed, entry: tag });
  }
  return entries;
}

/**
 * Resolves a Node.js release of the reviewed major line with the digest of its Linux archive.
 * @param source - The fixed distribution and major line.
 * @param version - The exact release, or `null` for the newest one of the line.
 * @param read - Reads a fixed metadata URL.
 */
export async function nodeRuntimeRelease(
  source: AgentToolNodeSource,
  version: string | null,
  read: ReleaseMetadataRead,
): Promise<AgentToolRelease> {
  const platform = nodePlatform();
  const index = parse(
    await read(
      `${NODE_DISTRIBUTION}/index.json`,
      { accept: "application/json" },
      NODE_INDEX_LIMIT,
    ),
  );
  const chosen = choose(nodeEntries(index, source, platform), version);
  const archive = `node-${chosen.entry}-${platform}.tar.gz`;
  const sums = await read(
    `${NODE_DISTRIBUTION}/${chosen.entry}/SHASUMS256.txt`,
    { accept: "text/plain" },
    NODE_INDEX_LIMIT,
  );
  const digest = sums
    .split("\n")
    .map((line) => /^([\da-f]{64}) {2}(\S+)$/u.exec(line.trim()))
    .find((match) => match?.[2] === archive)?.[1];
  if (!digest) throw new ReleaseMetadataError();
  return {
    version: chosen.version,
    integrity: `sha256:${digest}`,
    archiveUrl: `${NODE_DISTRIBUTION}/${chosen.entry}/${archive}`,
    dependencies: {},
  };
}

interface PythonAsset {
  readonly digest: string;
  readonly url: string;
}

function pythonReleaseAssets(release: unknown): {
  readonly tag: string;
  readonly assets: readonly unknown[];
} | null {
  if (!record(release)) return null;
  const tag = text(release, "tag_name");
  if (
    tag === null ||
    !/^\d{8}$/u.test(tag) ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  )
    return null;
  return { tag, assets: release.assets };
}

function pythonAsset(
  asset: unknown,
  tag: string,
  pattern: RegExp,
  source: AgentToolPythonSource,
): VersionedEntry<PythonAsset> | null {
  if (!record(asset)) return null;
  const name = text(asset, "name") ?? "";
  const version = pattern.exec(name)?.[1];
  const parsed = version ? readStableVersion(version) : null;
  const digest = text(asset, "digest");
  const url = text(asset, "browser_download_url");
  const expectedUrl = `https://github.com/${source.repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  if (!version || !parsed || !version.startsWith(`${source.line}.`))
    return null;
  if (!digest || !/^sha256:[\da-f]{64}$/u.test(digest) || url !== expectedUrl)
    throw new ReleaseMetadataError();
  return { version, parsed, entry: { digest, url } };
}

function pythonAssets(
  release: unknown,
  source: AgentToolPythonSource,
): readonly VersionedEntry<PythonAsset>[] {
  const published = pythonReleaseAssets(release);
  if (!published) return [];
  const { tag } = published;
  const pattern = new RegExp(
    `^cpython-(\\d+\\.\\d+\\.\\d+)\\+${tag}-${pythonTriple()}-install_only\\.tar\\.gz$`,
    "u",
  );
  return published.assets.flatMap((asset) => {
    const entry = pythonAsset(asset, tag, pattern, source);
    return entry ? [entry] : [];
  });
}

/**
 * Resolves a CPython build of the reviewed minor line with the digest of its archive.
 * @param source - The fixed project and minor line.
 * @param version - The exact release, or `null` for the newest build of the newest release.
 * @param read - Reads a fixed metadata URL.
 * @remarks
 * An exact version is looked up in the last few releases, because each
 * release rebuilds the newest patch of every line.
 */
export async function pythonRuntimeRelease(
  source: AgentToolPythonSource,
  version: string | null,
  read: ReleaseMetadataRead,
): Promise<AgentToolRelease> {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "pages-agent-tools",
  };
  const base = `${GITHUB_API}/repos/${source.repository}/releases`;
  const document = parse(
    await read(
      version === null
        ? `${base}/latest`
        : `${base}?per_page=${PYTHON_RELEASE_PAGE}`,
      headers,
      PYTHON_RELEASE_LIMIT,
    ),
  );
  const releases: readonly unknown[] = Array.isArray(document)
    ? document
    : [document];
  // Releases come newest first, so an exact version takes its newest build.
  const chosen = choose(
    releases.flatMap((release) => pythonAssets(release, source)),
    version,
  );
  return {
    version: chosen.version,
    integrity: chosen.entry.digest,
    archiveUrl: chosen.entry.url,
    dependencies: {},
  };
}
