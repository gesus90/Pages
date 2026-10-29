import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { AgentToolLocation, AgentToolStorage } from "./AgentToolContracts";

const RELEASES: Readonly<
  Record<string, { readonly archive: string; readonly sha256: string }>
> = {
  x64: {
    archive: "agy-acp-server-1.4.4-linux-x86_64.zip",
    sha256: "baf31b7a97602dee359cf2a43f72b6e11c6bf354be874987d80660cd3526bb6a",
  },
  arm64: {
    archive: "agy-acp-server-1.4.4-linux-arm64.zip",
    sha256: "b0273227c07cfa1ea5c1d9ff869b64c5b2b39b98862081fcd4c597ec316e0c57",
  },
};

async function download(file: string, signal: AbortSignal): Promise<void> {
  const release =
    process.platform === "linux" ? RELEASES[process.arch] : undefined;
  if (!release)
    throw new Error("Antigravity ACP requires a supported Linux architecture");
  const response = await fetch(
    `https://dl.google.com/agy-extensions/releases/linux/${release.archive}`,
    { signal, redirect: "error" },
  );
  if (!response.ok || !response.body)
    throw new Error("Antigravity archive unavailable");
  const hash = createHash("sha256");
  let bytes = 0;
  const verify = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      bytes += chunk.length;
      if (bytes > 500 * 1024 * 1024) {
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
  if (hash.digest("hex") !== release.sha256)
    throw new Error("Antigravity archive integrity mismatch");
}

/** Installs both checksum-pinned official runtime files into an unpublished generation. */
export async function installAntigravityRelease(
  input: {
    readonly candidate: AgentToolLocation;
    readonly files: AgentToolStorage;
    readonly locator: Pick<CliLocator, "locate">;
    readonly runner: Pick<CliProcessRunner, "run">;
  },
  signal: AbortSignal,
): Promise<void> {
  const release = input.candidate.release;
  if (!release) throw new Error("Missing Antigravity generation");
  const unzip = await input.locator.locate("unzip");
  if (!unzip.path) throw new Error("Antigravity installation requires unzip");
  const archive = path.join(release, "adapter.zip");
  try {
    await download(archive, signal);
    const result = await input.runner.run({
      file: unzip.path,
      arguments: [
        "-j",
        archive,
        "agy_acp_server.par",
        "localharness_external",
        "-d",
        release,
      ],
      provider: "antigravity",
      home: await input.files.home(),
      signal,
      stdin: "ignore",
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Antigravity extraction failed");
    for (const name of ["agy_acp_server.par", "localharness_external"])
      await chmod(path.join(release, name), 0o700);
  } finally {
    await rm(archive, { force: true });
  }
}
