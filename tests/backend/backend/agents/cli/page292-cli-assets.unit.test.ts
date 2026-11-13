import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliAssetWorkspace } from "@/backend/agents/cli/CliAssetWorkspace";
import { STREAMED_ASSET_REASON } from "@/backend/service/agents/AgentTicketAssetService";
import { digestStream } from "@/backend/storage/StreamDigest";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

const MIB = 1024 * 1024;
const SIZE = 12 * MIB + 5;

function generated(): Readable {
  return Readable.from(
    (function* chunks(): Generator<Buffer> {
      for (let offset = 0; offset < SIZE; offset += MIB)
        yield Buffer.alloc(Math.min(MIB, SIZE - offset), 9);
    })(),
  );
}

function digestOfFile(): string {
  const hash = createHash("sha256");
  for (let offset = 0; offset < SIZE; offset += MIB)
    hash.update(Buffer.alloc(Math.min(MIB, SIZE - offset), 9));
  return hash.digest("hex");
}

function streamedContent(
  open: () => Promise<Readable>,
  digest = digestOfFile(),
): AgentTicketAssetContent {
  return {
    parameter: "files",
    ticketId: "plan",
    ticketKey: "plan",
    asset: { source: "plan", id: "asset", link: "/agent-plan-assets/asset" },
    fileName: "large.bin",
    owner: { type: "asset", id: "plan" },
    original: { mimeType: "application/octet-stream", size: SIZE, digest },
    content: { type: "file", reason: STREAMED_ASSET_REASON },
    open,
  };
}

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "pages-cli-assets-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function copiesIn(): Promise<string[]> {
  const directories = (await readdir(workspace)).filter((name) =>
    name.startsWith(".pages-assets-"),
  );
  return (
    await Promise.all(
      directories.map(async (name) =>
        (await readdir(path.join(workspace, name))).map((file) =>
          path.join(workspace, name, file),
        ),
      ),
    )
  ).flat();
}

it("copies a file above the memory budget to the workspace chunk by chunk and proves it", async () => {
  const open = vi.fn(async () => generated());
  const assets = new CliAssetWorkspace(workspace);
  const prepared = await assets.prepare({
    readTicketAssets: async () => [streamedContent(open)],
  });
  const [file] = (await prepared.readTicketAssets?.()) ?? [];
  expect(file?.path).toBeDefined();
  const copy = await stat(file?.path ?? "");
  expect(copy.size).toBe(SIZE);
  const measured = await digestStream(createReadStream(file?.path ?? ""), SIZE);
  expect(measured.digest).toBe(digestOfFile());
  expect(copy.mode & 0o777).toBe(0o600);
  await assets.cleanup();
  expect(await copiesIn()).toEqual([]);
});

it("does not copy the same file again in the next turn of a session while the copy is intact", async () => {
  const open = vi.fn(async () => generated());
  const assets = new CliAssetWorkspace(workspace);
  const input = { readTicketAssets: async () => [streamedContent(open)] };
  await assets.prepare(input);
  await assets.prepare(input);
  expect(open).toHaveBeenCalledTimes(1);
  const [copy] = await copiesIn();
  await appendFile(copy ?? "", "x");
  await expect(assets.prepare(input)).rejects.toMatchObject({
    code: "parameter_ticket_changed",
  });
  expect(open).toHaveBeenCalledTimes(1);
});

it("refuses and removes a copy that is not the measured original", async () => {
  const assets = new CliAssetWorkspace(workspace);
  await expect(
    assets.prepare({
      readTicketAssets: async () => [
        streamedContent(async () => generated(), "f".repeat(64)),
      ],
    }),
  ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
  expect(await copiesIn()).toEqual([]);
});

it("refuses a copy that was changed after it was made", async () => {
  const assets = new CliAssetWorkspace(workspace);
  const prepared = await assets.prepare({
    readTicketAssets: async () => [streamedContent(async () => generated())],
  });
  const [copy] = await copiesIn();
  await appendFile(copy ?? "", "x");
  await expect(prepared.readTicketAssets?.()).rejects.toMatchObject({
    code: "parameter_ticket_changed",
  });
});
