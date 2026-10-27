import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { remoteAssetFile } from "@/backend/service/agents/AgentAssetRemoteFile";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { assetRepresentation } from "@/backend/service/agents/AgentAssetRepresentations";
import {
  externalAssetNotes,
  ticketAssetReferences,
} from "@/backend/service/agents/AgentTicketAssetReferences";
import { acpTicketAssetPrompt } from "@/backend/agents/acp/AcpTicketAssets";
import { readPdfDocument } from "@/backend/service/chat/ChatPdfText";
import { AgentAssetDownloadService } from "@/backend/service/agents/AgentAssetDownloadService";
import { readAssetReturn } from "@/backend/service/agents/AgentAssetReturnInput";

import { JPG, PNG, WEBP } from "./page160-asset-fixtures";
import { TICKET_ACTOR } from "./page55-ticket-fixture";
import { ticketAssetWorld } from "./page60-ticket-assets-fixture";

import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("@/backend/service/chat/ChatPdfText", () => ({
  readPdfDocument: vi.fn(),
}));

const REFERENCE = {
  source: "ticket",
  id: "png",
  link: "/aufgaben/attachments/png",
} as const;
const OWNER: AgentIdentity = {
  userId: TICKET_ACTOR.id,
  isAdmin: true,
  permissions: [],
};

describe("asset representations", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPG],
    ["image/webp", WEBP],
  ] as const)(
    "preserves original %s bytes, MIME and integrity locally and for remote pinning",
    async (mimeType, bytes) => {
      const world = ticketAssetWorld();
      world.files.set("png", bytes);
      const file = await world.assets.read(TICKET_ACTOR, REFERENCE);
      expect(file.bytes).toEqual(bytes);
      expect(file.original).toEqual({
        mimeType,
        size: bytes.length,
        digest: createHash("sha256").update(bytes).digest("hex"),
      });
      expect(file.content).toEqual({
        type: "image",
        mimeType,
        base64: bytes.toString("base64"),
      });
    },
  );

  it.each([
    "\uFEFFGrüße\n",
    '<svg xmlns="http://www.w3.org/2000/svg"><script>doNotRun()</script></svg>',
    "<!doctype html><html>source only</html>",
  ])(
    "preserves complete UTF-8 sources including BOM and never evaluates markup",
    async (source) => {
      const result = await assetRepresentation(Buffer.from(source));
      expect(result.content).toEqual({
        type: "text",
        text: source,
        representation: "source",
      });
    },
  );

  it("labels complete and bounded PDF extracts separately from the original and reports absent text", async () => {
    vi.mocked(readPdfDocument).mockResolvedValueOnce({
      status: "read",
      document: {
        sections: [{ kind: "page", number: 1, text: "PDF text" }],
        sheets: [],
        isTruncated: true,
      },
    });
    expect(await assetRepresentation(Buffer.from("%PDF-original"))).toEqual({
      mimeType: "application/pdf",
      content: {
        type: "text",
        representation: "text-extract",
        isTruncated: true,
        text: "PDF text",
      },
    });
    vi.mocked(readPdfDocument).mockResolvedValueOnce({ status: "encrypted" });
    expect(
      await assetRepresentation(Buffer.from("%PDF-encrypted")),
    ).toMatchObject({ content: { type: "file", reason: "pdf-encrypted" } });
  });

  it("identifies corrupt raster input with its filename and keeps unsupported binary as original-only", async () => {
    const world = ticketAssetWorld();
    world.files.set("png", PNG.subarray(0, 24));
    await expect(
      world.assets.read(TICKET_ACTOR, REFERENCE),
    ).rejects.toMatchObject({
      code: "parameter_asset_unavailable",
      fileName: "diagram.png",
      asset: REFERENCE,
    });
    await expect(
      world.assets.read(TICKET_ACTOR, REFERENCE),
    ).rejects.toBeInstanceOf(AgentAssetError);
    expect(await assetRepresentation(Buffer.from([0, 255, 0]))).toMatchObject({
      content: { type: "file", reason: "unsupported-model-content" },
    });
  });
});

describe("model image capabilities", () => {
  it("does not imply image understanding when the ACP adapter has only text capability", () => {
    const blocks = acpTicketAssetPrompt(
      "read source",
      [
        {
          parameter: "ticket",
          ticketId: "t",
          ticketKey: "PAGE-1",
          asset: REFERENCE,
          fileName: "picture.webp",
          content: {
            type: "image",
            mimeType: "image/webp",
            base64: WEBP.toString("base64"),
          },
        },
      ],
      { image: false },
    );
    expect(blocks.every((block) => block.type === "text")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("no image has been viewed");
  });
});

describe("external Markdown sources", () => {
  it("retains inline and reference badges without downloading them or interpreting examples", () => {
    const markdown =
      "![badge](https://img.shields.io/badge/test-green)\n![reference][badge]\n\n[badge]: https://example.invalid/banner.webp\n\n`![example](https://inline.invalid/a.png)`\n\n```md\n![example](https://code.invalid/a.png)\n```";
    expect(ticketAssetReferences(markdown)).toEqual([]);
    const notes = externalAssetNotes(markdown);
    expect(notes).toContain("not-fetched");
    expect(notes).toContain("shields.io");
    expect(notes).toContain("example.invalid");
    expect(notes).not.toContain("inline.invalid");
    expect(notes).not.toContain("code.invalid");
  });
});

describe("authorized original downloads", () => {
  function downloads(): {
    readonly service: AgentAssetDownloadService;
    readonly world: ReturnType<typeof ticketAssetWorld>;
    readonly verify: ReturnType<
      typeof vi.fn<(hash: string) => Promise<AgentIdentity>>
    >;
  } {
    const world = ticketAssetWorld();
    const verify = vi.fn(async () => OWNER);
    const service = new AgentAssetDownloadService({
      assets: world.assets,
      users: { getById: async () => TICKET_ACTOR },
      verify,
    });
    return { service, world, verify };
  }

  it("returns a digest-bound one-use original download and rejects replay", async () => {
    const { service, verify } = downloads();
    const prepared = await service.prepare(OWNER, "credential", {
      link: REFERENCE.link,
    });
    expect(prepared).toMatchObject({
      header: "X-Pages-Download-Ticket",
      representation: "model-image",
      contentType: "image/png",
    });
    const file = await service.consume(prepared.ticket);
    expect(file.original.digest).toBe(prepared.digest);
    expect(verify).toHaveBeenCalledWith(
      createHash("sha256").update("credential").digest("hex"),
    );
    await expect(service.consume(prepared.ticket)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rechecks revocation, changed bytes and access instead of trusting preparation", async () => {
    const { service, world, verify } = downloads();
    const changed = await service.prepare(OWNER, "credential", {
      link: REFERENCE.link,
    });
    world.files.set("png", JPG);
    await expect(service.consume(changed.ticket)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const revoked = await service.prepare(OWNER, "credential", {
      link: REFERENCE.link,
    });
    verify.mockRejectedValueOnce(new Error("revoked"));
    await expect(service.consume(revoked.ticket)).rejects.toThrow("revoked");
    world.denied.add("png");
    await expect(
      service.prepare(OWNER, "credential", { link: REFERENCE.link }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    "/etc/passwd",
    "https://external.invalid/a.png",
    "/aufgaben/attachments/png?x=1",
    "//external.invalid/aufgaben/attachments/png",
  ])("refuses a noncanonical download reference %s", async (link) => {
    await expect(
      downloads().service.prepare(OWNER, "credential", { link }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("asset return selection", () => {
  it("requires an operation ID and current digest for an explicit replacement", () => {
    expect(() =>
      readAssetReturn({ ticketId: TICKET_ACTOR.id, replace: true }),
    ).toThrow();
    expect(() =>
      readAssetReturn({
        ticketId: TICKET_ACTOR.id,
        operationId: "return-1",
        sourceAttachmentId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
    expect(
      readAssetReturn({
        ticketId: TICKET_ACTOR.id,
        operationId: "return-1",
        sourceAttachmentId: "10000000-0000-4000-8000-000000000001",
        expectedDigest: "a".repeat(64),
        replace: true,
      }),
    ).toMatchObject({ replace: true, operationId: "return-1" });
  });
});

it("keeps PDF content transient and labels an oversized extraction instead of presenting it as complete", async () => {
  vi.mocked(readPdfDocument).mockResolvedValueOnce({
    status: "read",
    document: {
      sections: [{ kind: "page", number: 1, text: "x".repeat(400_001) }],
      sheets: [],
      isTruncated: false,
    },
  });
  const result = await assetRepresentation(Buffer.from("%PDF-original"));
  expect(result.content).toMatchObject({
    type: "text",
    representation: "text-extract",
    isTruncated: true,
  });
  if (result.content.type !== "text") throw new Error("Expected text extract");
  expect(result.content.text).toHaveLength(400_000);
  const metadata = remoteAssetFile("ticket", REFERENCE, {
    fileName: "document.pdf",
    original: { mimeType: "application/pdf", size: 13, digest: "a".repeat(64) },
    content: result.content,
  });
  expect(metadata).not.toHaveProperty("textExtract");
  expect(metadata).toMatchObject({
    representation: "text-extract",
    isTruncated: true,
    modelSize: 400_002,
  });
});
