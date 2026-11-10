import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { STREAMED_ASSET_REASON } from "@/backend/service/agents/AgentTicketAssetService";
import { RunnerAssetCursors } from "@/backend/service/runner/RunnerAssetCursors";
import { RunnerParameterFiles } from "@/backend/service/runner/RunnerParameterFiles";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  AgentPlanRemoteParameters,
  RemoteParameterAsset,
} from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { ParameterFileAccess } from "@/backend/service/runner/RunnerParameterFiles";
import type { Mock } from "vitest";

const MIB = 1024 * 1024;
const CHUNK = 512 * 1024;
const SIZE = 2 * MIB + 321;

function content(): Buffer {
  const bytes = Buffer.alloc(SIZE);
  for (let index = 0; index < SIZE; index += 1) bytes[index] = index % 251;
  return bytes;
}

function pinned(
  digest = createHash("sha256").update(content()).digest("hex"),
): RemoteParameterAsset {
  return {
    owner: { type: "ticket", id: "ticket" },
    reference: {
      source: "ticket",
      id: "file",
      link: "/aufgaben/attachments/file",
    },
    file: {
      parameter: "files",
      name: "large.bin",
      type: "application/octet-stream",
      size: SIZE,
      digest,
      modelContent: STREAMED_ASSET_REASON,
      representation: "original",
      outcome: "input",
    },
  };
}

interface World {
  readonly files: RunnerParameterFiles;
  readonly access: ParameterFileAccess;
  readonly authorizeAsset: Mock;
  readonly readAssetContent: Mock;
  readonly write: Mock;
}

function world(asset: RemoteParameterAsset): World {
  const authorizeAsset = vi.fn(async () => undefined);
  const readAssetContent = vi.fn();
  const write = vi.fn(async () => undefined);
  const files = new RunnerParameterFiles({
    parameters: partial<AgentPlanRemoteParameters>({
      isStreamed: () => true,
      authorizeAsset,
      readAssetContent,
      openAsset: async () => Readable.from([content()]),
    }),
    evidence: partial<
      ConstructorParameters<typeof RunnerParameterFiles>[0]["evidence"]
    >({ write }),
  });
  return {
    files,
    access: {
      run: partial<ParameterFileAccess["run"]>({
        id: "run",
        userId: "user",
        steps: [{ id: "step", execution: { attemptId: "attempt" } }],
      }),
      remote: partial<ParameterFileAccess["remote"]>({
        step: { id: "step" },
        parameters: { assets: [asset] },
      }),
      cursors: new RunnerAssetCursors(),
    },
    authorizeAsset,
    readAssetContent,
    write,
  };
}

interface ChunkAnswer {
  readonly base64: string;
  readonly size: number;
  readonly done: boolean;
}

function chunkOf(
  files: RunnerParameterFiles,
  access: ParameterFileAccess,
  offset: number,
): Promise<ChunkAnswer> {
  return files.chunk(access, {
    kind: "asset",
    index: 0,
    offset,
  }) as Promise<ChunkAnswer>;
}

async function readAll(
  files: RunnerParameterFiles,
  access: ParameterFileAccess,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const answer = await chunkOf(files, access, offset);
    const bytes = Buffer.from(answer.base64, "base64");
    expect(answer.size).toBe(SIZE);
    expect(bytes.length).toBeLessThanOrEqual(CHUNK);
    parts.push(bytes);
    offset += bytes.length;
    if (answer.done) return Buffer.concat(parts);
  }
}

describe("the parameter files of a remote step above the memory budget", () => {
  it("are listed without being read", async () => {
    const { files, access, readAssetContent } = world(pinned());
    const manifest = (await files.manifest(access)) as {
      files: { name: string; size: number; textExtract?: string }[];
    };
    expect(manifest.files).toMatchObject([{ name: "large.bin", size: SIZE }]);
    expect(manifest.files[0]?.textExtract).toBeUndefined();
    expect(readAssetContent).not.toHaveBeenCalled();
  });

  it("reach the runner complete, in chunks, with the evidence written once", async () => {
    const { files, access, write, authorizeAsset } = world(pinned());
    expect((await readAll(files, access)).equals(content())).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(authorizeAsset.mock.calls.length).toBe(Math.ceil(SIZE / CHUNK));
  });

  it("check owner and rights with every chunk and stop when they are gone", async () => {
    const { files, access, authorizeAsset } = world(pinned());
    await chunkOf(files, access, 0);
    authorizeAsset.mockRejectedValueOnce(
      new AgentError("parameter_ticket_changed"),
    );
    await expect(chunkOf(files, access, CHUNK)).rejects.toMatchObject({
      code: "parameter_ticket_changed",
      fileName: "large.bin",
    });
  });

  it("fail at the end when the file is not the one that was pinned", async () => {
    const { files, access } = world(pinned("e".repeat(64)));
    await expect(readAll(files, access)).rejects.toMatchObject({
      code: "parameter_ticket_changed",
    });
  });

  it("refuse a chunk behind the end of the file", async () => {
    const { files, access } = world(pinned());
    await expect(chunkOf(files, access, SIZE + 1)).rejects.toMatchObject({
      code: "parameter_asset_unavailable",
    });
  });
});
