import {
  compareStableVersions,
  readStableVersion,
  satisfiesVersionRange,
} from "@/definition/AgentToolVersion";

import { isAgentToolVersionSupported } from "./AgentToolRegistry";

import type {
  AgentToolDefinition,
  AgentToolGitHubSource,
  AgentToolNpmSource,
} from "./AgentToolRegistry";
import type { StableVersion } from "@/definition/AgentToolVersion";
import type { AgentToolRelease } from "./AgentToolContracts";

const NPM_REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
const METADATA_LIMIT = 4 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 15_000;
// The abbreviated version list of a package with thousands of releases.
const PACKUMENT_LIMIT = 16 * 1024 * 1024;

/** Why release metadata did not name a usable release. */
export type AgentToolReleaseFailure = "unreachable" | "failed" | "incompatible";

/** The outcome of reading one fixed source; a failure never names a release. */
export type AgentToolReleaseOutcome =
  | { readonly ok: true; readonly release: AgentToolRelease }
  | { readonly ok: false; readonly failure: AgentToolReleaseFailure };

/** A source could not be reached, which is not the same as having no update. */
class ReleaseSourceUnreachableError extends Error {}

/** The source answered with metadata Pages does not accept. */
class ReleaseMetadataError extends Error {}

/** The source names a pre-release or another non-stable version. */
class ReleaseIncompatibleError extends Error {}

function failureOf(
  error: unknown,
  signal: AbortSignal,
): AgentToolReleaseFailure | null {
  if (error instanceof ReleaseSourceUnreachableError) return "unreachable";
  if (error instanceof ReleaseMetadataError) return "failed";
  if (error instanceof ReleaseIncompatibleError) return "incompatible";
  return signal.aborted ? "unreachable" : null;
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function packagePath(packageName: string): string {
  return packageName.split("/").map(encodeURIComponent).join("/");
}

function text(input: Record<string, unknown>, key: string): string | null {
  const field = input[key];
  return typeof field === "string" ? field : null;
}

/**
 * Reads release metadata of the registry's fixed official sources only.
 * @remarks
 * Reading metadata never installs or activates anything. A network error is
 * reported as an unreachable source, malformed metadata as a failed check and
 * a pre-release or a release below the minimum as incompatible.
 */
export class AgentToolReleaseCheck {
  private readonly fetcher: typeof fetch;

  public constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  /** Reads the newest stable release a source publishes. */
  public async latest(
    tool: AgentToolDefinition,
    signal: AbortSignal,
  ): Promise<AgentToolReleaseOutcome> {
    return this.resolve(tool, null, signal);
  }

  /**
   * Resolves one exact release with its integrity proof.
   * @param tool - The tool whose release is read.
   * @param version - The release to install, or `null` for the newest stable one.
   * @param signal - Aborts the metadata request.
   */
  public async resolve(
    tool: AgentToolDefinition,
    version: string | null,
    signal: AbortSignal,
  ): Promise<AgentToolReleaseOutcome> {
    if (!tool.release) return { ok: false, failure: "failed" };
    try {
      const release =
        tool.release.kind === "npm"
          ? await this.npm(tool.release, version, signal)
          : await this.github(tool.release, version, signal);
      if (version !== null && release.version !== version)
        return { ok: false, failure: "failed" };
      if (!isAgentToolVersionSupported(tool, release.version))
        return { ok: false, failure: "incompatible" };
      return { ok: true, release };
    } catch (error: unknown) {
      const failure = failureOf(error, signal);
      if (failure === null) throw error;
      return { ok: false, failure };
    }
  }

  /**
   * The newest stable npm release inside a range, for a CLI its adapter limits.
   * @param tool - The tool whose release is read.
   * @param range - The range the adapter declares for the CLI package.
   * @param signal - Aborts the metadata request.
   * @returns `null` when no stable release at or above the minimum satisfies it.
   */
  public async newestInRange(
    tool: AgentToolDefinition,
    range: string,
    signal: AbortSignal,
  ): Promise<AgentToolReleaseOutcome> {
    if (tool.release?.kind !== "npm") return { ok: false, failure: "failed" };
    try {
      const document = await this.json(
        `${NPM_REGISTRY}/${packagePath(tool.release.packageName)}`,
        { accept: "application/vnd.npm.install-v1+json" },
        signal,
        PACKUMENT_LIMIT,
      );
      const versions = record(document.versions)
        ? Object.keys(document.versions)
        : [];
      const newest = versions
        .filter(
          (version) =>
            satisfiesVersionRange(version, range) === true &&
            isAgentToolVersionSupported(tool, version),
        )
        .map((version) => ({ version, parsed: readStableVersion(version) }))
        .filter(
          (entry): entry is { version: string; parsed: StableVersion } =>
            entry.parsed !== null,
        )
        .sort((left, right) => compareStableVersions(right.parsed, left.parsed))
        .at(0);
      if (!newest) return { ok: false, failure: "incompatible" };
      return this.resolve(tool, newest.version, signal);
    } catch (error: unknown) {
      const failure = failureOf(error, signal);
      if (failure === null) throw error;
      return { ok: false, failure };
    }
  }

  private async npm(
    source: AgentToolNpmSource,
    version: string | null,
    signal: AbortSignal,
  ): Promise<AgentToolRelease> {
    const manifest = await this.json(
      `${NPM_REGISTRY}/${packagePath(source.packageName)}/${version === null ? "latest" : encodeURIComponent(version)}`,
      { accept: "application/json" },
      signal,
    );
    const found = text(manifest, "version");
    const dist = manifest.dist;
    if (
      text(manifest, "name") !== source.packageName ||
      found === null ||
      !record(dist)
    )
      throw new ReleaseMetadataError();
    if (readStableVersion(found) === null) throw new ReleaseIncompatibleError();
    const integrity = text(dist, "integrity");
    if (integrity === null || !/^sha512-[A-Za-z0-9+/]+=*$/u.test(integrity))
      throw new ReleaseMetadataError();
    const dependencies = record(manifest.dependencies)
      ? manifest.dependencies
      : {};
    return {
      version: found,
      integrity,
      archiveUrl: null,
      dependencies: Object.fromEntries(
        Object.entries(dependencies).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    };
  }

  private async github(
    source: AgentToolGitHubSource,
    version: string | null,
    signal: AbortSignal,
  ): Promise<AgentToolRelease> {
    const asset =
      process.platform === "linux" ? source.assets[process.arch] : undefined;
    if (!asset) throw new ReleaseMetadataError();
    const release = await this.json(
      `${GITHUB_API}/repos/${source.repository}/releases/${version === null ? "latest" : `tags/${encodeURIComponent(version)}`}`,
      {
        accept: "application/vnd.github+json",
        "user-agent": "pages-agent-tools",
      },
      signal,
    );
    const tag = text(release, "tag_name");
    if (
      tag === null ||
      release.draft !== false ||
      !Array.isArray(release.assets)
    )
      throw new ReleaseMetadataError();
    if (readStableVersion(tag) === null || release.prerelease !== false)
      throw new ReleaseIncompatibleError();
    const entry: unknown = release.assets.find(
      (candidate: unknown) => record(candidate) && candidate.name === asset,
    );
    if (!record(entry)) throw new ReleaseMetadataError();
    const digest = text(entry, "digest");
    const url = text(entry, "browser_download_url");
    const expectedUrl = `https://github.com/${source.repository}/releases/download/${tag}/${asset}`;
    if (!digest || !/^sha256:[\da-f]{64}$/u.test(digest) || url !== expectedUrl)
      throw new ReleaseMetadataError();
    return {
      version: tag.replace(/^v/u, ""),
      integrity: digest,
      archiveUrl: url,
      dependencies: {},
    };
  }

  private async json(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    limit = METADATA_LIMIT,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(METADATA_TIMEOUT_MS),
        ]),
      });
    } catch {
      throw new ReleaseSourceUnreachableError();
    }
    if (response.status === 404) throw new ReleaseMetadataError();
    if (!response.ok) throw new ReleaseSourceUnreachableError();
    const body = await response.text().catch(() => {
      throw new ReleaseSourceUnreachableError();
    });
    if (Buffer.byteLength(body) > limit) throw new ReleaseMetadataError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ReleaseMetadataError();
    }
    if (!record(parsed)) throw new ReleaseMetadataError();
    return parsed;
  }
}
