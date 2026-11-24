import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation, AgentToolStorage } from "./AgentToolContracts";

const ARCHIVE_LIMIT = 500 * 1024 * 1024;

/** One official archive with the digest its release metadata publishes. */
export interface OfficialArchiveDownload {
  readonly tool: AgentToolId;
  readonly url: string;
  /** `sha256:<hex>` as the release metadata publishes it. */
  readonly digest: string;
  readonly file: string;
}

/** A runtime archive that unpacks completely into one unpublished generation. */
export interface RuntimeArchive {
  readonly tool: AgentToolId;
  readonly candidate: AgentToolLocation;
  readonly archiveUrl: string;
  readonly digest: string;
  readonly files: AgentToolStorage;
  readonly locator: Pick<CliLocator, "locate">;
  readonly runner: Pick<CliProcessRunner, "run">;
  readonly temporaryDirectory: string;
}

/**
 * Downloads an official archive and refuses it unless its SHA-256 digest matches.
 * @throws {AgentToolReadinessError} `integrity_failed` for a different content.
 */
export async function downloadOfficialArchive(
  input: OfficialArchiveDownload,
  signal: AbortSignal,
): Promise<void> {
  // Release assets may redirect to their download host; the digest proves the content.
  const response = await fetch(input.url, { signal, redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error("Official archive unavailable");
  const hash = createHash("sha256");
  let bytes = 0;
  const verify = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      bytes += chunk.length;
      if (bytes > ARCHIVE_LIMIT) {
        callback(new Error("Official archive exceeds limit"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.from(response.body),
    verify,
    createWriteStream(input.file, { mode: 0o600, flags: "wx" }),
    { signal },
  );
  if (`sha256:${hash.digest("hex")}` !== input.digest)
    throw new AgentToolReadinessError(input.tool, "failed", "integrity_failed");
}

/**
 * Installs a checksum-verified Node.js or Python archive into an unpublished generation.
 * @remarks
 * The archive's top folder becomes the generation, so `bin/<binary>` and the
 * libraries it loads stay together. The program has to resolve inside the
 * generation; a link out of it is refused.
 */
export async function installRuntimeArchive(
  input: RuntimeArchive,
  signal: AbortSignal,
): Promise<void> {
  const release = input.candidate.release;
  if (!release) throw new Error("Missing runtime generation");
  const tar = await input.locator.locate("tar");
  if (!tar.path) throw new Error("Runtime installation requires tar");
  const archive = path.join(release, "release.tar.gz");
  try {
    await downloadOfficialArchive(
      {
        tool: input.tool,
        url: input.archiveUrl,
        digest: input.digest,
        file: archive,
      },
      signal,
    );
    const result = await input.runner.run({
      file: tar.path,
      arguments: [
        "--extract",
        "--gzip",
        "--no-same-owner",
        "--no-same-permissions",
        "--strip-components=1",
        "--file",
        archive,
        "--directory",
        release,
      ],
      provider: "codex_cli",
      home: await input.files.home(),
      environment: { TMPDIR: input.temporaryDirectory },
      signal,
      stdin: "ignore",
      timeoutMs: 300_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Runtime extraction failed");
  } finally {
    await rm(archive, { force: true });
  }
  await requireRuntimeProgram(input.candidate.file, release);
}

async function requireRuntimeProgram(
  file: string,
  release: string,
): Promise<void> {
  const link = await lstat(file);
  const target = link.isSymbolicLink() ? await realpath(file) : file;
  if (
    !containsWorkspacePath(await realpath(release), target) ||
    !(await stat(target)).isFile()
  )
    throw new Error("Runtime archive has an unexpected layout");
}
