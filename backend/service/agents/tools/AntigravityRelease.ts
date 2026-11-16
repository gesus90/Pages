import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { AgentToolLocation, AgentToolStorage } from "./AgentToolContracts";

const ARCHIVE_LIMIT = 500 * 1024 * 1024;

/** The official archive and the program it carries, both fixed by the registry. */
interface OfficialArchive {
  readonly candidate: AgentToolLocation;
  readonly binary: string;
  readonly member: string;
  readonly archiveUrl: string;
  /** `sha256:<hex>` as the release metadata publishes it. */
  readonly digest: string;
  readonly files: AgentToolStorage;
  readonly locator: Pick<CliLocator, "locate">;
  readonly runner: Pick<CliProcessRunner, "run">;
  readonly temporaryDirectory: string;
}

async function download(
  input: OfficialArchive,
  file: string,
  signal: AbortSignal,
): Promise<void> {
  // The release asset redirects to GitHub's download host; the digest proves the content.
  const response = await fetch(input.archiveUrl, {
    signal,
    redirect: "follow",
  });
  if (!response.ok || !response.body)
    throw new Error("Antigravity archive unavailable");
  const hash = createHash("sha256");
  let bytes = 0;
  const verify = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      bytes += chunk.length;
      if (bytes > ARCHIVE_LIMIT) {
        callback(new Error("Antigravity archive exceeds limit"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.from(response.body),
    verify,
    createWriteStream(file, { mode: 0o600, flags: "wx" }),
    { signal },
  );
  if (`sha256:${hash.digest("hex")}` !== input.digest)
    throw new Error("Antigravity archive integrity mismatch");
}

/**
 * Installs the official Antigravity CLI into an unpublished generation.
 * @remarks
 * Only the one program of the checksum-verified archive is extracted. The
 * CLI serves ACP itself through `agy acp`, so no separate adapter exists.
 */
export async function installAntigravityRelease(
  input: OfficialArchive,
  signal: AbortSignal,
): Promise<void> {
  const release = input.candidate.release;
  if (!release) throw new Error("Missing Antigravity generation");
  const tar = await input.locator.locate("tar");
  if (!tar.path) throw new Error("Antigravity installation requires tar");
  const archive = path.join(release, "release.tar.gz");
  try {
    await download(input, archive, signal);
    const result = await input.runner.run({
      file: tar.path,
      arguments: [
        "--extract",
        "--gzip",
        "--no-same-owner",
        "--no-same-permissions",
        "--file",
        archive,
        "--directory",
        release,
        "--",
        input.member,
      ],
      provider: "antigravity",
      home: await input.files.home(),
      environment: { TMPDIR: input.temporaryDirectory },
      signal,
      stdin: "ignore",
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Antigravity extraction failed");
    const extracted = path.join(release, input.member);
    const metadata = await lstat(extracted);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("Antigravity archive has an unexpected layout");
    const target = path.join(release, input.binary);
    if (extracted !== target) await rename(extracted, target);
    await chmod(target, 0o700);
  } finally {
    await rm(archive, { force: true });
  }
}
