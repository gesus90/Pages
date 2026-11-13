import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import { AgentTicketAssetSnapshots } from "@/backend/service/agents/AgentTicketAssetSnapshots";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { collectStream } from "@/backend/storage/StreamBytes";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { assetFiles } from "./page331-memory-assets";
import { parameterRunFixture } from "./page55-run-fixture";
import { TICKET } from "./page55-ticket-fixture";
import {
  ticketAssetWorld,
  ticketDeclaration,
  PNG,
} from "./page60-ticket-assets-fixture";

import type * as fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

vi.mock("node:fs/promises", async () => ({
  ...(await import("./page331-memory-assets")).assetFiles.promises(),
  open: vi.fn((file: string) => assetFiles.open(file)),
}));
vi.mock("node:fs", async () => ({
  ...(await vi.importActual<typeof fs>("node:fs")),
  createWriteStream: (file: string) => assetFiles.writer(file),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
  withLogContext: vi.fn((context: unknown, work: () => unknown) => work()),
}));

const ASSET: AgentTicketAsset = {
  source: "ticket",
  id: "attachment-369",
  link: "/aufgaben/attachments/attachment-369",
};
const BYTES = Buffer.from("frozen attachment");
const ORIGINAL = {
  fileName: "original.txt",
  bytes: BYTES,
  original: {
    mimeType: "text/plain",
    size: BYTES.length,
    digest: createHash("sha256").update(BYTES).digest("hex"),
  },
};
const LOCATION = `/private/ticket-asset-snapshots/${ORIGINAL.original.digest}`;

beforeEach(() => {
  assetFiles.reset();
  vi.clearAllMocks();
});

function expectIoFailure(error: Error): void {
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith({
    level: "error",
    event: "agent.ticket_assets.snapshot_io_failed",
    component: "AgentTicketAssetSnapshots",
    message: `Snapshot I/O failed for attachment ${ASSET.id}`,
    metadata: { source: "ticket" },
    error,
  });
}

describe("PAGE-369 ticket attachment start", () => {
  it.each([1, 3])(
    "freezes all %i attachments and passes their complete bytes to the agent, also on a fresh start",
    async (count) => {
      const world = ticketAssetWorld("Ticket with uploaded attachments");
      const identifiers = count === 1 ? ["png"] : ["png", "second", "third"];
      world.files.set("second", Buffer.from("second attachment"));
      world.files.set("third", Buffer.from("third attachment"));
      vi.mocked(world.dependencies.tickets.list).mockResolvedValue(
        identifiers.map((id) => ({ id })),
      );
      const service = new AgentTicketParameterService(
        world.context,
        world.assets,
        undefined,
        new AgentTicketAssetSnapshots("/private"),
      );
      const fixture = await parameterRunFixture(
        {
          ...emptyAgentConfiguration(),
          markdown: "{{ticket.assets}}",
          parameters: [ticketDeclaration("ticket")],
        },
        "codex_cli",
        service,
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const pinned = await service.pinAssets(
          "owner",
          fixture.step.prepared.parameters.assetInputs,
        );
        const step = {
          ...fixture.step,
          prepared: {
            ...fixture.step.prepared,
            parameters: {
              ...fixture.step.prepared.parameters,
              assetInputs: pinned,
            },
          },
        };
        const started = await fixture.start.prepare(
          fixture.run,
          { ...fixture.snapshot, steps: [step] },
          step,
        );
        const received = await started.input.readTicketAssets?.();
        expect(received?.map((file) => file.asset.id)).toEqual(identifiers);
        expect(received?.map((file) => Buffer.from(file.bytes ?? []))).toEqual(
          identifiers.map((id) => world.files.get(id)),
        );
        expect(received?.[0].bytes).toEqual(PNG);
        expect(pinned[0]?.ticket.id).toBe(TICKET.id);
        for (const file of received ?? []) {
          expect(
            assetFiles.contents.get(
              `/private/ticket-asset-snapshots/${file.original?.digest}`,
            ),
          ).toEqual(Buffer.from(file.bytes ?? []));
        }
        expect(assetFiles.contents.size).toBe(count);
      }
    },
  );
});

describe("PAGE-369 private snapshot verification", () => {
  it("reads inline and streamed bytes through independent handles after digest destruction", async () => {
    const snapshots = new AgentTicketAssetSnapshots("/private");
    const snapshot = await snapshots.pin(ORIGINAL, ASSET);
    expect(await snapshots.read(snapshot, BYTES.length, ASSET)).toMatchObject({
      bytes: BYTES,
    });
    const streamed = await snapshots.read(snapshot, 0, ASSET);
    if (!("open" in streamed)) throw new Error("Expected a streamed snapshot");
    expect(await collectStream(await streamed.open(), BYTES.length)).toEqual(
      BYTES,
    );
    expect(
      vi
        .mocked(open)
        .mock.calls.filter(([location]) => location === LOCATION)
        .every(
          ([, flags]) => flags === (constants.O_RDONLY | constants.O_NOFOLLOW),
        ),
    ).toBe(true);
  });

  it.each(["digest", "size"])(
    "refuses a changed %s without disguising it as an I/O failure",
    async (kind) => {
      const snapshots = new AgentTicketAssetSnapshots("/private");
      const snapshot = await snapshots.pin(ORIGINAL, ASSET);
      assetFiles.contents.set(
        LOCATION,
        kind === "digest"
          ? Buffer.alloc(BYTES.length, 65)
          : Buffer.from("short"),
      );
      await expect(
        snapshots.read(snapshot, BYTES.length, ASSET),
      ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
      expect(logEvent).not.toHaveBeenCalled();
    },
  );

  it.each(["ino", "dev", "size"] as const)(
    "refuses a replacement %s between measurement and reopening",
    async (field) => {
      const snapshots = new AgentTicketAssetSnapshots("/private");
      const snapshot = await snapshots.pin(ORIGINAL, ASSET);
      vi.mocked(open).mockImplementationOnce(async () =>
        partial<FileHandle>(await assetFiles.open(LOCATION)),
      );
      const reopened = await assetFiles.open(LOCATION);
      const stat = await reopened.stat();
      const close = vi.fn(reopened.close);
      vi.mocked(open).mockResolvedValueOnce(
        partial<FileHandle>({
          ...reopened,
          stat: async () => ({ ...stat, [field]: stat[field] + 1 }),
          close,
        }),
      );
      await expect(snapshots.open(snapshot, ASSET)).rejects.toMatchObject({
        code: "parameter_ticket_changed",
      });
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("refuses symlinks and reports the no-follow failure with its attachment", async () => {
    const snapshots = new AgentTicketAssetSnapshots("/private");
    const snapshot = await snapshots.pin(ORIGINAL, ASSET);
    assetFiles.links.add(LOCATION);
    await expect(snapshots.open(snapshot, ASSET)).rejects.toMatchObject({
      code: "parameter_asset_unavailable",
    });
    expect(vi.mocked(logEvent).mock.calls.at(-1)?.[0]).toMatchObject({
      error: { code: "ELOOP" },
    });
  });
});

describe("PAGE-369 snapshot I/O diagnostics", () => {
  it("logs a source read failure while freezing and removes its pending copy", async () => {
    const error = Object.assign(new Error("read failed"), { code: "EIO" });
    const snapshots = new AgentTicketAssetSnapshots("/private");
    await expect(
      snapshots.pin(
        {
          ...ORIGINAL,
          bytes: undefined,
          open: async () =>
            new Readable({
              read(): void {
                this.destroy(error);
              },
            }),
        },
        ASSET,
      ),
    ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
    expectIoFailure(error);
    expect(assetFiles.contents.size).toBe(0);
  });

  it("logs an open failure while verifying the frozen attachment", async () => {
    const snapshots = new AgentTicketAssetSnapshots("/private");
    await snapshots.pin(ORIGINAL, ASSET);
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(open).mockRejectedValueOnce(error);
    await expect(snapshots.pin(ORIGINAL, ASSET)).rejects.toMatchObject({
      code: "parameter_asset_unavailable",
    });
    expectIoFailure(error);
  });

  it("logs the original error when the digest stream fails", async () => {
    const snapshots = new AgentTicketAssetSnapshots("/private");
    const snapshot = await snapshots.pin(ORIGINAL, ASSET);
    const error = Object.assign(new Error("read failed"), { code: "EIO" });
    const handle = await assetFiles.open(LOCATION);
    const close = vi.fn(handle.close);
    vi.mocked(open).mockResolvedValueOnce(
      partial<FileHandle>({
        ...handle,
        close,
        createReadStream: () =>
          new Readable({
            read(): void {
              this.destroy(error);
            },
          }),
      }),
    );
    await expect(snapshots.open(snapshot, ASSET)).rejects.toMatchObject({
      code: "parameter_asset_unavailable",
    });
    expectIoFailure(error);
    expect(close).toHaveBeenCalledOnce();
  });
});
