import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  CONNECTION_ID,
  REQUEST_ID,
  TOKEN,
  envelope,
  openDefault,
  pagesAccessWorld,
  remoteWith,
} from "./runner-pages-access-harness";

import type { AgentAsset } from "@/definition/PagesAgentWrites";
import type { PagesAccessWorld } from "./runner-pages-access-harness";

type UploadRequest = Extract<
  Parameters<typeof envelope>[0],
  { kind: "upload" }
>;

const MIB = 1024 * 1024;
const TICKET = "k".repeat(43);
const LINK = "/aufgaben/attachments/file-1";
const OTHER_LINK = "/wiki/attachments/file-2";

let world: PagesAccessWorld;

beforeEach(async () => {
  world = pagesAccessWorld();
  world.issue.mockResolvedValue({
    token: TOKEN,
    expiresAt: Date.now() + 60_000,
  });
  await openDefault(world);
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const OUTPUT = Buffer.from("finished output");

function uploadOf(
  overrides: Partial<UploadRequest> = {},
): Promise<Readonly<Record<string, unknown>>> {
  return world.service.receive(
    CONNECTION_ID,
    envelope({
      kind: "upload",
      ticket: TICKET,
      offset: 0,
      base64: OUTPUT.toString("base64"),
      done: true,
      digest: sha256(OUTPUT),
      ...overrides,
    }),
  );
}

function asset(overrides: Partial<AgentAsset> = {}): AgentAsset {
  return {
    assetId: "asset-1",
    link: LINK,
    fileName: "out.txt",
    contentType: "text/plain",
    size: OUTPUT.length,
    expiresAt: null,
    ...overrides,
  };
}

describe("RunnerPagesAccessService uploads", () => {
  beforeEach(() => {
    world.api.verify.mockResolvedValue({ run: { reach: "full" } });
    world.api.uploadAsset.mockResolvedValue(asset());
  });

  it("stores a finished upload and records it as uploaded evidence", async () => {
    await expect(uploadOf()).resolves.toMatchObject({
      ok: true,
      result: { link: LINK },
    });

    expect(world.api.verify).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(world.api.uploadAsset).toHaveBeenCalledExactlyOnceWith(
      TICKET,
      OUTPUT,
    );
    expect(world.evidence()?.files).toEqual([
      {
        parameter: "output",
        name: "out.txt",
        type: "text/plain",
        size: OUTPUT.length,
        digest: sha256(OUTPUT),
        asset: { source: "ticket", id: "file-1", link: LINK },
        representation: "original",
        outcome: "uploaded",
      },
    ]);
  });

  it("records a temporary upload as staged", async () => {
    world.api.uploadAsset.mockResolvedValue(
      asset({ expiresAt: 1_900_000_000 }),
    );

    await uploadOf();

    expect(world.evidence()?.files[0].outcome).toBe("staged");
  });

  it("keeps one evidence entry when the same output is replayed", async () => {
    await uploadOf();
    await uploadOf();

    expect(world.evidence()?.files).toHaveLength(1);
  });

  it("keeps a staged and an uploaded entry of the same file apart", async () => {
    world.api.uploadAsset.mockResolvedValueOnce(
      asset({ expiresAt: 1_900_000_000 }),
    );
    await uploadOf();
    await uploadOf();

    expect(world.evidence()?.files.map((file) => file.outcome)).toEqual([
      "staged",
      "uploaded",
    ]);
  });

  it("records no evidence for a link that is no Pages attachment", async () => {
    world.api.uploadAsset.mockResolvedValue(
      asset({ link: "https://example.test/out.txt" }),
    );

    await expect(uploadOf()).resolves.toMatchObject({ ok: true });

    expect(world.evidence()?.files).toEqual([]);
  });

  it("acknowledges a partial chunk with the next offset and stores nothing", async () => {
    const half = OUTPUT.subarray(0, 5);

    await expect(
      uploadOf({ base64: half.toString("base64"), done: false }),
    ).resolves.toMatchObject({ ok: true, result: { offset: 5 } });

    expect(world.api.uploadAsset).not.toHaveBeenCalled();
    expect(world.evidence()?.files).toEqual([]);
  });
});

describe("RunnerPagesAccessService upload failures", () => {
  beforeEach(() => {
    world.api.verify.mockResolvedValue({ run: { reach: "full" } });
    world.api.uploadAsset.mockResolvedValue(asset());
  });

  it("refuses an upload for a credential without full reach", async () => {
    world.api.verify.mockResolvedValue({ run: { reach: "read" } });

    await expect(uploadOf()).resolves.toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: false,
      error: "plan_access_denied",
      assetFailure: {
        id: "output",
        name: "output",
        cause: "plan_access_denied",
      },
    });
    expect(world.api.uploadAsset).not.toHaveBeenCalled();
  });

  it("refuses an upload for a credential that carries no run scope", async () => {
    world.api.verify.mockResolvedValue({});

    await expect(uploadOf()).resolves.toMatchObject({
      error: "plan_access_denied",
    });
  });

  it("reports a digest mismatch as an unavailable output", async () => {
    await expect(uploadOf({ digest: "0".repeat(64) })).resolves.toMatchObject({
      ok: false,
      error: "parameter_asset_unavailable",
      assetFailure: { cause: "parameter_asset_unavailable" },
    });
  });

  it.each([
    ["CONFLICT", "parameter_asset_conflict"],
    ["FORBIDDEN", "parameter_asset_write_denied"],
    ["INVALID_REQUEST", "parameter_asset_output_invalid"],
    ["NOT_FOUND", "parameter_asset_unavailable"],
    ["PAYLOAD_TOO_LARGE", "parameter_assets_too_large"],
    ["AMBIGUOUS", "parameter_asset_unavailable"],
    ["CONFIRMATION_REQUIRED", "parameter_asset_unavailable"],
  ] as const)("maps a %s write failure to %s", async (code, cause) => {
    world.api.uploadAsset.mockRejectedValue(new AgentOperationError(code));

    await expect(uploadOf()).resolves.toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: false,
      error: cause,
      assetFailure: { id: "output", name: "output", cause },
    });
  });

  it("answers a plain failure without naming a file cause", async () => {
    world.api.uploadAsset.mockRejectedValue(new Error("disk full"));

    const answer = await uploadOf();

    expect(answer).toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: false,
      error: "plan_mcp_unavailable",
    });
  });

  it("lets the same bytes be stored again after a failed write", async () => {
    world.api.uploadAsset.mockRejectedValueOnce(new Error("busy"));
    await uploadOf();

    await expect(uploadOf()).resolves.toMatchObject({ ok: true });
  });

  it("drops buffered chunks when the step closes", async () => {
    await uploadOf({
      base64: OUTPUT.subarray(0, 5).toString("base64"),
      done: false,
    });
    await world.service.close("run-1", "step-1", "attempt-1");
    await openDefault(world);

    await expect(
      uploadOf({ offset: 5, base64: OUTPUT.subarray(5).toString("base64") }),
    ).resolves.toMatchObject({
      ok: false,
      assetFailure: { cause: "parameter_asset_unavailable" },
    });
  });
});

function fileOf(
  bytes: Buffer,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fileName: "notes.txt",
    content: {
      type: "text",
      text: "extract",
      representation: "text-extract",
    },
    original: {
      mimeType: "text/plain",
      size: bytes.length,
      digest: sha256(bytes),
    },
    bytes,
    size: bytes.length,
    ...overrides,
  };
}

function downloadOf(
  link = LINK,
  offset = 0,
  digest?: string,
): Promise<Readonly<Record<string, unknown>>> {
  return world.service.receive(
    CONNECTION_ID,
    envelope({ kind: "download", link, offset, digest }),
  );
}

describe("RunnerPagesAccessService downloads", () => {
  it("returns the file with its text extract and records tool evidence", async () => {
    const bytes = Buffer.from("hello world");
    world.api.downloadAsset.mockResolvedValue(fileOf(bytes));

    const answer = await downloadOf(LINK, 0, "a".repeat(64));

    expect(world.api.downloadAsset).toHaveBeenCalledExactlyOnceWith(
      TOKEN,
      LINK,
      "a".repeat(64),
    );
    expect(answer).toMatchObject({
      ok: true,
      result: {
        file: {
          parameter: "tool",
          name: "notes.txt",
          type: "text/plain",
          size: bytes.length,
          digest: sha256(bytes),
          asset: { source: "ticket", id: "file-1", link: LINK },
          representation: "text-extract",
          textExtract: "extract",
        },
        base64: bytes.toString("base64"),
        size: bytes.length,
        done: true,
      },
    });
    expect(world.evidence()?.files).toHaveLength(1);
    expect(world.evidence()?.files[0]).toMatchObject({
      parameter: "tool",
      outcome: "input",
    });
  });

  it("offers no text extract for source text or binary files", async () => {
    const bytes = Buffer.from("plain");
    world.api.downloadAsset.mockResolvedValue(
      fileOf(bytes, { content: { type: "text", text: "plain" } }),
    );
    const source = await downloadOf();

    world.api.downloadAsset.mockResolvedValue(
      fileOf(bytes, { content: { type: "file", reason: "binary" } }),
    );
    const binary = await downloadOf(OTHER_LINK);

    expect(source).toMatchObject({
      result: { file: { representation: "source" } },
    });
    expect(source).not.toHaveProperty("result.file.textExtract", "plain");
    expect(binary).toMatchObject({
      result: { file: { modelContent: "binary" } },
    });
    expect((binary as { result: { file: object } }).result.file).toHaveProperty(
      "textExtract",
      undefined,
    );
  });
});

describe("RunnerPagesAccessService download chunks", () => {
  it("serves a large file in chunks and finishes with the last one", async () => {
    const bytes = Buffer.alloc(600 * 1024, 7);
    world.api.downloadAsset.mockResolvedValue(fileOf(bytes));

    const first = await downloadOf(LINK, 0);
    const last = await downloadOf(LINK, 512 * 1024);

    expect(first).toMatchObject({
      result: { size: bytes.length, done: false },
    });
    expect(
      Buffer.from(
        (first as { result: { base64: string } }).result.base64,
        "base64",
      ),
    ).toHaveLength(512 * 1024);
    expect(last).toMatchObject({ result: { done: true } });
    expect(
      Buffer.from(
        (last as { result: { base64: string } }).result.base64,
        "base64",
      ),
    ).toHaveLength(88 * 1024);
  });

  it("answers an empty finished chunk at the end of the file", async () => {
    const bytes = Buffer.from("abc");
    world.api.downloadAsset.mockResolvedValue(fileOf(bytes));

    await expect(downloadOf(LINK, 3)).resolves.toMatchObject({
      ok: true,
      result: { base64: "", done: true },
    });
  });

  it("refuses an offset beyond the file and names the file", async () => {
    const bytes = Buffer.from("abc");
    world.api.downloadAsset.mockResolvedValue(fileOf(bytes));

    await expect(downloadOf(LINK, 4)).resolves.toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: false,
      error: "parameter_asset_unavailable",
      assetFailure: {
        id: "file-1",
        name: "notes.txt",
        cause: "parameter_asset_unavailable",
      },
    });
    expect(world.evidence()?.files).toEqual([]);
  });

  it.each([
    ["a foreign address", "https://example.test/aufgaben/attachments/a"],
    ["a plain path", "/etc/passwd"],
    ["a link with a query", `${LINK}?download=1`],
    ["a link with a trailing slash", `${LINK}/`],
  ])("refuses %s as an unsupported reference", async (name, link) => {
    await expect(downloadOf(link)).resolves.toMatchObject({
      ok: false,
      error: "parameter_asset_reference_unsupported",
    });
    expect(world.api.downloadAsset).not.toHaveBeenCalled();
  });

  it("pins the digest of a file after its first download", async () => {
    const bytes = Buffer.from("pinned");
    world.api.downloadAsset.mockResolvedValue(fileOf(bytes));

    await downloadOf(LINK, 0);
    await downloadOf(LINK, 0, "b".repeat(64));

    expect(world.api.downloadAsset.mock.calls).toEqual([
      [TOKEN, LINK, undefined],
      [TOKEN, LINK, sha256(bytes)],
    ]);
  });

  it("keeps one evidence entry per downloaded file", async () => {
    const bytes = Buffer.from("same");
    world.api.downloadAsset.mockResolvedValue(fileOf(bytes));

    await downloadOf(LINK);
    await downloadOf(LINK);
    await downloadOf(OTHER_LINK);

    expect(world.evidence()?.files.map((file) => file.asset?.link)).toEqual([
      LINK,
      OTHER_LINK,
    ]);
  });
});

describe("RunnerPagesAccessService download limits", () => {
  it("refuses a file that would take the downloads past 10 MiB", async () => {
    world.api.downloadAsset.mockResolvedValueOnce(
      fileOf(Buffer.alloc(6 * MIB)),
    );
    await downloadOf(LINK);
    world.api.downloadAsset.mockResolvedValueOnce(
      fileOf(Buffer.alloc(5 * MIB), { fileName: "second.bin" }),
    );

    await expect(downloadOf(OTHER_LINK)).resolves.toMatchObject({
      ok: false,
      error: "parameter_assets_too_large",
      assetFailure: { id: "file-2", name: "second.bin" },
    });
    expect(world.evidence()?.files).toHaveLength(1);
  });
});

describe("RunnerPagesAccessService download budget", () => {
  it("allows downloads that add up to exactly 10 MiB", async () => {
    world.api.downloadAsset.mockResolvedValueOnce(
      fileOf(Buffer.alloc(6 * MIB)),
    );
    await downloadOf(LINK);
    world.api.downloadAsset.mockResolvedValueOnce(
      fileOf(Buffer.alloc(4 * MIB)),
    );

    await expect(downloadOf(OTHER_LINK)).resolves.toMatchObject({ ok: true });
  });

  it("lets a pinned file be read again when the budget is used up", async () => {
    world.api.downloadAsset.mockResolvedValueOnce(
      fileOf(Buffer.alloc(10 * MIB)),
    );
    await downloadOf(LINK);
    world.api.downloadAsset.mockResolvedValueOnce(
      fileOf(Buffer.alloc(10 * MIB)),
    );

    await expect(downloadOf(LINK, 512 * 1024)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a new file when the parameter files and downloads fill the 64 slots", async () => {
    const crowded = pagesAccessWorld();
    crowded.issue.mockResolvedValue({
      token: TOKEN,
      expiresAt: Date.now() + 60_000,
    });
    await openDefault(
      crowded,
      remoteWith({
        parameters: {
          tickets: {},
          assets: Array.from({ length: 64 }, () => ({})),
        },
      }),
    );
    crowded.api.downloadAsset.mockResolvedValue(fileOf(Buffer.from("x")));

    await expect(
      crowded.service.receive(
        CONNECTION_ID,
        envelope({ kind: "download", link: LINK, offset: 0 }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: "parameter_assets_too_large",
      assetFailure: { name: "notes.txt" },
    });
  });

  it("passes on a refusal of the file service with the file of the failure", async () => {
    world.api.downloadAsset.mockRejectedValue(
      new AgentAssetError(
        "parameter_asset_type_unsupported",
        { source: "ticket", id: "file-1", link: LINK },
        "movie.mp4",
      ),
    );

    await expect(downloadOf()).resolves.toMatchObject({
      ok: false,
      error: "parameter_asset_type_unsupported",
      assetFailure: {
        id: "file-1",
        name: "movie.mp4",
        cause: "parameter_asset_type_unsupported",
      },
    });
  });

  it("answers an operation error of a download as unavailable", async () => {
    world.api.downloadAsset.mockRejectedValue(
      new AgentOperationError("FORBIDDEN"),
    );

    await expect(downloadOf()).resolves.toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: false,
      error: "plan_mcp_unavailable",
    });
  });

  it("keeps an application code of a download that carries no file", async () => {
    world.api.downloadAsset.mockRejectedValue(
      new AgentError("plan_access_denied"),
    );

    await expect(downloadOf()).resolves.toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: false,
      error: "plan_access_denied",
    });
  });
});
