import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  AgentTicketAssetService,
  STREAMED_ASSET_REASON,
} from "@/backend/service/agents/AgentTicketAssetService";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { PlanAssetService } from "@/backend/service/agents/assets/PlanAssetService";
import { RunnerAssetCursors } from "@/backend/service/runner/RunnerAssetCursors";
import { collectStream } from "@/backend/storage/StreamBytes";
import {
  digestStream,
  StreamTooLargeError,
} from "@/backend/storage/StreamDigest";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { TICKET_ACTOR } from "./page55-ticket-fixture";

import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { PlanAssetDependencies } from "@/backend/service/agents/assets/PlanAssetService";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";
import type { Mock } from "vitest";

const MIB = 1024 * 1024;
const BIG: AgentTicketAsset = {
  source: "ticket",
  id: "big",
  link: "/aufgaben/attachments/big",
};

/** A file of `size` bytes in 1 MiB chunks; no more than one chunk exists at a time. */
function generated(size: number): Readable {
  return Readable.from(
    (function* chunks(): Generator<Buffer> {
      for (let offset = 0; offset < size; offset += MIB)
        yield Buffer.alloc(Math.min(MIB, size - offset), 7);
    })(),
  );
}

function digestOf(size: number): string {
  const hash = createHash("sha256");
  for (let offset = 0; offset < size; offset += MIB)
    hash.update(Buffer.alloc(Math.min(MIB, size - offset), 7));
  return hash.digest("hex");
}

function assetService(
  size: number,
  stream: () => Readable = () => generated(size),
): {
  readonly service: AgentTicketAssetService;
  readonly open: Mock;
} {
  const open = vi.fn(async () => ({
    attachment: { fileName: "big.bin", size },
    stream: stream(),
  }));
  const dependencies: AgentTicketAssetDependencies = {
    tickets: { list: async () => [], open },
    wiki: { openAttachment: open },
    assets: {
      open: async () => {
        const opened = await open();
        return { ...opened.attachment, stream: opened.stream };
      },
    },
  };
  return { service: new AgentTicketAssetService(dependencies), open };
}

describe("a plan step receives files up to 512 MiB", () => {
  it("states the limit as 512 × 1024 × 1024 bytes", () => {
    expect(PLAN_HANDOVER_LIMITS.bytes).toBe(536_870_912);
    expect(PLAN_HANDOVER_LIMITS.files).toBe(64);
  });

  it("measures a file above the memory budget as a stream and keeps no bytes", async () => {
    const { service } = assetService(12 * MIB);
    const file = await service.readForHandover(
      TICKET_ACTOR,
      BIG,
      PLAN_HANDOVER_LIMITS.inlineBytes,
    );
    expect("bytes" in file).toBe(false);
    expect(file).toMatchObject({
      size: 12 * MIB,
      content: { type: "file", reason: STREAMED_ASSET_REASON },
      original: { size: 12 * MIB, digest: digestOf(12 * MIB) },
    });
    if (!("open" in file)) throw new Error("A stream was expected");
    const copy = await collectStream(await file.open(), 12 * MIB);
    expect(copy.length).toBe(12 * MIB);
  });

  it("does not read a measured file again for the next check", async () => {
    const reads = vi.fn();
    const { service } = assetService(11 * MIB, () => {
      reads();
      return generated(11 * MIB);
    });
    await service.readForHandover(TICKET_ACTOR, BIG, 10 * MIB);
    const second = await service.readForHandover(TICKET_ACTOR, BIG, 10 * MIB);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(second.original.digest).toBe(digestOf(11 * MIB));
  });

  it("holds a file in memory only while the budget of the step lasts", async () => {
    const { service } = assetService(6 * MIB);
    expect(
      "bytes" in (await service.readForHandover(TICKET_ACTOR, BIG, 10 * MIB)),
    ).toBe(true);
    expect(
      "bytes" in (await service.readForHandover(TICKET_ACTOR, BIG, 5 * MIB)),
    ).toBe(false);
  });

  it("refuses a file above 512 MiB without reading it", async () => {
    const unread = new Readable({
      read() {
        this.destroy(new Error("The file must not be read"));
      },
    });
    const { service } = assetService(
      PLAN_HANDOVER_LIMITS.bytes + 1,
      () => unread,
    );
    await expect(
      service.readForHandover(TICKET_ACTOR, BIG, 10 * MIB),
    ).rejects.toMatchObject({ code: "parameter_assets_too_large" });
    expect(unread.destroyed).toBe(true);
  });

  it("keeps the rights of the person: a refused file is never measured or handed over", async () => {
    const { service, open } = assetService(12 * MIB);
    open.mockRejectedValueOnce(new Error("Private file"));
    await expect(
      service.readForHandover(TICKET_ACTOR, BIG, 10 * MIB),
    ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
  });

  it("keeps the 10 MiB limit for every other read of an attachment", async () => {
    const { service } = assetService(10 * MIB + 1);
    await expect(service.read(TICKET_ACTOR, BIG)).rejects.toMatchObject({
      code: "parameter_assets_too_large",
    });
  });
});

describe("the total of a step is bounded", () => {
  function streamed(size: number): ReturnType<typeof parameterService> {
    return parameterService(size);
  }

  function parameterService(size: number): {
    readonly service: AgentTicketParameterService;
    readonly input: (
      count: number,
    ) => Parameters<AgentTicketParameterService["readAssets"]>[1];
  } {
    const service = new AgentTicketParameterService(
      async () => ({
        actor: TICKET_ACTOR,
        tasks: {
          findAll: async () => [],
          getById: async () => {
            throw new Error("A plan asset needs no ticket");
          },
          findChecklistItems: async () => [],
        },
      }),
      {
        references: async () => [],
        requireReadable: async () => undefined,
        readForHandover: async (actor, asset) => ({
          fileName: asset.id,
          size,
          content: { type: "file", reason: STREAMED_ASSET_REASON },
          original: {
            mimeType: "application/zip",
            size,
            digest: "a".repeat(64),
          },
          open: async () => generated(1),
        }),
      },
    );
    return {
      service,
      input: (count) => [
        {
          parameter: "files",
          owner: "asset",
          ticket: {
            id: "plan",
            key: "plan",
            title: "plan",
            description: "",
            markdown: "",
            version: "1",
            assets: Array.from({ length: count }, (_, index) => ({
              source: "plan" as const,
              id: `asset-${index}`,
              link: `/agent-plan-assets/asset-${index}`,
            })),
          },
        },
      ],
    };
  }

  it("hands over 400 MiB as streams", async () => {
    const { service, input } = streamed(200 * MIB);
    const contents = await service.readAssets("owner", input(2));
    expect(contents.map((file) => file.original?.size)).toEqual([
      200 * MIB,
      200 * MIB,
    ]);
    expect(contents.every((file) => file.open && !file.bytes)).toBe(true);
  });

  it("refuses more than 512 MiB in all, naming the file", async () => {
    const { service, input } = streamed(200 * MIB);
    await expect(service.readAssets("owner", input(3))).rejects.toMatchObject({
      code: "parameter_assets_too_large",
      fileName: "asset-2",
    });
  });

  it("refuses the 65th file", async () => {
    const { service, input } = streamed(1);
    await expect(service.readAssets("owner", input(64))).resolves.toHaveLength(
      64,
    );
    await expect(service.readAssets("owner", input(65))).rejects.toMatchObject({
      code: "parameter_assets_too_large",
    });
  });
});

describe("a runner reads a large file in sequential chunks", () => {
  const SIZE = 3 * MIB + 123;
  const CHUNK = 512 * 1024;
  const file = (
    open: () => Promise<Readable>,
    digest = digestOf(SIZE),
  ): { size: number; digest: string; open: () => Promise<Readable> } => ({
    size: SIZE,
    digest,
    open,
  });

  async function readAll(
    cursors: RunnerAssetCursors,
    pinned: ReturnType<typeof file>,
  ): Promise<number> {
    let offset = 0;
    while (offset < SIZE) {
      const chunk = await cursors.read(0, offset, CHUNK, pinned);
      expect(chunk.length).toBe(Math.min(CHUNK, SIZE - offset));
      offset += chunk.length;
    }
    return offset;
  }

  it("opens the file once, however many chunks it has", async () => {
    const open = vi.fn(async () => generated(SIZE));
    const cursors = new RunnerAssetCursors();
    expect(await readAll(cursors, file(open))).toBe(SIZE);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("answers a repeated chunk without reading on and restarts for an earlier one", async () => {
    const open = vi.fn(async () => generated(SIZE));
    const cursors = new RunnerAssetCursors();
    const pinned = file(open);
    const first = await cursors.read(0, 0, CHUNK, pinned);
    const second = await cursors.read(0, CHUNK, CHUNK, pinned);
    expect(await cursors.read(0, CHUNK, CHUNK, pinned)).toEqual(second);
    expect(open).toHaveBeenCalledTimes(1);
    expect(await cursors.read(0, 0, CHUNK, pinned)).toEqual(first);
    expect(open).toHaveBeenCalledTimes(2);
    // Skipping ahead is read and dropped on the open file instead of starting over.
    expect(await cursors.read(0, 2 * CHUNK, CHUNK, pinned)).toHaveLength(CHUNK);
    expect(open).toHaveBeenCalledTimes(2);
    cursors.close();
  });

  it("fails at the end of a file that is not the pinned one", async () => {
    const cursors = new RunnerAssetCursors();
    const changed = file(async () => generated(SIZE), "b".repeat(64));
    await expect(readAll(cursors, changed)).rejects.toMatchObject({
      code: "parameter_ticket_changed",
    });
  });

  it("fails for a file that ends early or has grown", async () => {
    const cursors = new RunnerAssetCursors();
    await expect(
      readAll(
        cursors,
        file(async () => generated(SIZE - 1)),
      ),
    ).rejects.toBeInstanceOf(AgentError);
    await expect(
      readAll(
        cursors,
        file(async () => generated(SIZE + 1)),
      ),
    ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
  });
});

describe("the upload limit of a plan asset", () => {
  function uploads(): {
    readonly service: PlanAssetService;
    readonly write: Mock;
  } {
    const write = vi.fn(async () => ({
      storageName: "stored",
      size: 11 * MIB,
      checksum: "c".repeat(64),
    }));
    const service = new PlanAssetService({
      repository: partial<PlanAssetDependencies["repository"]>({
        insert: async (asset: { readonly id: string }) => ({
          ...asset,
          createdAt: "2026-01-01",
        }),
      }),
      files: partial<PlanAssetDependencies["files"]>({
        write,
        remove: async () => undefined,
      }),
      authorization: {
        snapshot: async () =>
          partial<
            Awaited<
              ReturnType<PlanAssetDependencies["authorization"]["snapshot"]>
            >
          >({ accounts: [{ userId: "owner", isActive: true }] }),
      },
      content: { canReadProject: async () => true },
    });
    return { service, write };
  }

  const upload = (
    contentLength: number | null,
  ): Parameters<PlanAssetService["upload"]>[1] => ({
    projectId: "project",
    fileName: "plan.bin",
    contentLength,
    body: generated(1),
  });

  it("accepts exactly 512 MiB and streams it with that limit", async () => {
    const { service, write } = uploads();
    await service.upload("owner", upload(PLAN_HANDOVER_LIMITS.bytes));
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ absoluteLimit: PLAN_HANDOVER_LIMITS.bytes }),
    );
  });

  it("accepts a file above 10 MiB", async () => {
    const { service } = uploads();
    await expect(
      service.upload("owner", upload(11 * MIB)),
    ).resolves.toMatchObject({ size: 11 * MIB });
  });

  it("refuses a longer announced length before reading the body", async () => {
    const { service, write } = uploads();
    await expect(
      service.upload("owner", upload(PLAN_HANDOVER_LIMITS.bytes + 1)),
    ).rejects.toMatchObject({ code: "plan_asset_too_large" });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a body that outgrows the limit while it arrives", async () => {
    const { service, write } = uploads();
    write.mockRejectedValueOnce(new FileTooLargeError());
    await expect(service.upload("owner", upload(null))).rejects.toMatchObject({
      code: "plan_asset_too_large",
    });
  });
});

describe("stream helpers", () => {
  it("stop at their limit and release the stream", async () => {
    const stream = generated(3 * MIB);
    await expect(digestStream(stream, 2 * MIB)).rejects.toBeInstanceOf(
      StreamTooLargeError,
    );
    expect(stream.destroyed).toBe(true);
    await expect(
      collectStream(generated(3 * MIB), 2 * MIB),
    ).rejects.toBeInstanceOf(StreamTooLargeError);
  });
});
