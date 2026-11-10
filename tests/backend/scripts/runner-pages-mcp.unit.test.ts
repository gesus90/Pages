import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { fakeNet, okReply, type PagesEnvelope } from "./runner-pages-net-fake";

vi.mock("node:net", async () =>
  (await import("./runner-pages-net-fake")).netModule(),
);

const JOB = "0b9f6a52-3f0c-4a55-9d8e-6a1a8f6c2d11";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

interface McpReply {
  readonly id: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string };
}

interface World {
  readonly root: string;
  readonly socketPath: string;
  readonly runtime: string;
  readonly workspace: string;
}

let world: World;
const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
const originalArgv = [...process.argv];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Runs the `--mcp` entry of the script against the given stdin lines. */
async function serve(
  lines: readonly (object | string)[],
  jobId = JOB,
): Promise<McpReply[]> {
  const written: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: Readable.from(
      lines.map(
        (line) =>
          (typeof line === "string" ? line : JSON.stringify(line)) + "\n",
      ),
    ),
  });
  process.argv = ["node", "pages.mjs", "--mcp", world.socketPath, jobId];
  // The script runs its MCP loop while it is imported, so every run needs a
  // fresh module graph. The mocked network module survives the reset.
  vi.resetModules();
  await import("@/scripts/runner/pages.mjs");
  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as McpReply);
}

function call(name: string, args: object, id = 1): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

function textOf(reply: McpReply): string[] {
  const content = reply.result?.content as { text?: string }[];
  return content.map((block) => block.text ?? "");
}

function requests(): Record<string, unknown>[] {
  return fakeNet.clientSockets.map(
    (socket) => (JSON.parse(socket.written) as PagesEnvelope).request,
  );
}

beforeAll(async () => {
  // Builds the mocked network module before the first module reset.
  await import("node:net");
});

beforeEach(async () => {
  fakeNet.reset();
  const root = await realpath(await mkdtemp(join(tmpdir(), "pages-mcp-unit-")));
  const runtime = join(root, "jobs", JOB, "runtime");
  const workspace = join(root, "workspace");
  await mkdir(runtime, { recursive: true });
  await mkdir(workspace);
  world = { root, socketPath: join(root, "pages.sock"), runtime, workspace };
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.argv = originalArgv;
  if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor);
  await rm(world.root, { recursive: true, force: true });
});

describe("Pages MCP server", () => {
  it("rejects a job id that is no identifier", async () => {
    await expect(serve([], "../escape")).rejects.toThrow("Invalid Pages job");
  });

  it("answers the protocol methods and ignores notifications", async () => {
    const replies = await serve([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
      { jsonrpc: "2.0", id: 3, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3]);
    expect(replies[0]?.result).toEqual({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "pages-run-step", version: "1.7.0" },
    });
    expect(replies[1]?.result?.protocolVersion).toBe("2025-03-26");
    expect(replies[2]?.result).toEqual({});
    expect(requests()).toEqual([]);
  });

  it("answers a refused or unsupported request with an error and survives bad lines", async () => {
    const replies = await serve([
      "not json",
      "x".repeat(65537),
      { jsonrpc: "2.0", id: 4, method: "resources/list" },
      { jsonrpc: "2.0", id: 5, method: "ping" },
    ]);
    expect(replies).toEqual([
      {
        jsonrpc: "2.0",
        id: 4,
        error: {
          code: -32603,
          message: "Pages step access unavailable or request refused.",
        },
      },
      { jsonrpc: "2.0", id: 5, result: {} },
    ]);
  });

  it("lists the tools of the step plus the file tools its rights allow", async () => {
    const names = async (tools: object[]): Promise<string[]> => {
      fakeNet.handler = () => okReply({ tools });
      const [reply] = await serve([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
      ]);
      return (reply?.result?.tools as { name: string }[]).map(
        (tool) => tool.name,
      );
    };
    expect(await names([{ name: "read_ticket" }])).toEqual([
      "read_ticket",
      "read_parameter_file",
    ]);
    expect(
      await names([
        { name: "prepare_asset_download" },
        { name: "prepare_asset_upload" },
      ]),
    ).toEqual([
      "prepare_asset_download",
      "prepare_asset_upload",
      "read_parameter_file",
      "read_asset",
      "return_asset",
    ]);
  });

  it("forwards a Pages tool call and marks an error result", async () => {
    fakeNet.handler = (envelope) =>
      okReply(
        envelope.request.name === "broken"
          ? { isError: true, message: "no" }
          : { ticket: "T-1" },
      );
    const replies = await serve([
      call("read_ticket", { id: "T-1" }, 1),
      call("broken", {}, 2),
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "x" } },
    ]);
    expect(replies[0]?.result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ticket: "T-1" }) }],
    });
    expect(replies[1]?.result?.isError).toBe(true);
    expect(requests()[0]).toEqual({
      kind: "call",
      name: "read_ticket",
      arguments: { id: "T-1" },
    });
    expect(requests()[2]).toEqual({ kind: "call", name: "x", arguments: {} });
  });
});

describe("read_parameter_file", () => {
  async function stage(
    name: string,
    bytes: Buffer,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const path = join(world.workspace, name);
    await writeFile(path, bytes);
    await writeFile(
      join(world.runtime, "assets-manifest.json"),
      JSON.stringify([
        {
          name,
          path,
          type: "text/plain",
          size: bytes.length,
          digest: sha256(bytes),
          representation: "original",
          ...overrides,
        },
      ]),
    );
    fakeNet.handler = () => okReply({});
  }

  async function read(index: unknown): Promise<McpReply> {
    const [reply] = await serve([call("read_parameter_file", { index })]);
    return reply;
  }

  it("leases the file, rechecks the right and returns UTF-8 source", async () => {
    await stage("a.txt", Buffer.from("source ä"));
    const reply = await read(0);
    expect(textOf(reply)[1]).toBe("source ä");
    expect(JSON.parse(textOf(reply)[0] ?? "")).toMatchObject({ name: "a.txt" });
    expect(requests()).toEqual([
      { kind: "lease" },
      { kind: "asset", index: 0, offset: 0 },
    ]);
  });

  it("returns an image as a native block", async () => {
    await stage("a.png", PNG, { type: "image/png" });
    const reply = await read(0);
    expect(reply.result?.content).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: PNG.toString("base64"),
    });
  });

  it("returns a labelled PDF extract", async () => {
    await stage("a.pdf", Buffer.from("%PDF"), {
      representation: "text-extract",
      textExtract: "page one",
      isTruncated: false,
    });
    expect(textOf(await read(0))[1]).toBe(
      "PDF text extract; truncated=false\npage one",
    );
  });

  it("reports an original-only file and verifies a streamed one on disk", async () => {
    await stage("a.bin", Buffer.from("bin"), { modelContent: "binary" });
    expect(textOf(await read(0))[1]).toBe(
      "Original file only: binary. No model content available.",
    );
    await stage("big.bin", Buffer.from("big"), {
      modelContent: "too-large-for-model",
    });
    expect(textOf(await read(0))[1]).toBe(
      "Original file only: too-large-for-model. No model content available.",
    );
  });

  it("refuses an unknown index, a changed original and a changed streamed original", async () => {
    await stage("a.txt", Buffer.from("source"));
    expect((await read(5)).error?.code).toBe(-32603);
    expect((await read("0")).error?.code).toBe(-32603);

    await stage("b.txt", Buffer.from("source"), { digest: "0".repeat(64) });
    expect((await read(0)).error).toBeDefined();

    await stage("c.bin", Buffer.from("source"), {
      modelContent: "too-large-for-model",
      digest: "0".repeat(64),
    });
    expect((await read(0)).error).toBeDefined();
  });
});

const LINK = "/aufgaben/attachments/abc";

function serveDownload(bytes: Buffer, chunkSize: number, extra = {}): void {
  const file = {
    name: "pic.png",
    type: "image/png",
    size: bytes.length,
    digest: sha256(bytes),
    ...extra,
  };
  fakeNet.handler = (envelope) => {
    const offset = envelope.request.offset as number;
    return okReply({
      size: bytes.length,
      file,
      base64: bytes.subarray(offset, offset + chunkSize).toString("base64"),
    });
  };
}

async function stageDirectory(): Promise<string> {
  const directory = join(world.workspace, ".pages-assets-run");
  await mkdir(directory);
  await writeFile(
    join(world.runtime, "assets-directory.json"),
    JSON.stringify({ root: world.workspace, directory }),
  );
  return directory;
}

async function download(link: unknown = LINK): Promise<McpReply> {
  const [reply] = await serve([call("read_asset", { link })]);
  return reply;
}

describe("read_asset", () => {
  it("downloads in chunks, materializes the original and returns it", async () => {
    const directory = await stageDirectory();
    serveDownload(PNG, 3);
    const reply = await download();
    expect(reply.result?.content).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: PNG.toString("base64"),
    });
    const stored = await readdir(directory);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^download-[a-f0-9]{24}-pic\.png$/);
    expect(requests().map((request) => request.offset)).toEqual([0, 3, 6]);
    expect(requests()[1]).toMatchObject({ digest: sha256(PNG) });
    expect(requests()[0]).not.toHaveProperty("digest");
  });

  it("reuses a materialized original after verifying it", async () => {
    const directory = await stageDirectory();
    serveDownload(PNG, 512);
    await download();
    fakeNet.reset();
    serveDownload(PNG, 512);
    const again = await download();
    expect(again.error).toBeUndefined();
    expect(await readdir(directory)).toHaveLength(1);

    const [stored] = await readdir(directory);
    await writeFile(join(directory, stored), "tampered!");
    fakeNet.reset();
    serveDownload(PNG, 512);
    expect((await download()).error).toBeDefined();
  });

  it("returns source text and honours the model content of the file", async () => {
    await stageDirectory();
    const text = Buffer.from("plain text");
    serveDownload(text, 512, { name: "a.txt", type: "text/plain" });
    expect(textOf(await download())[1]).toBe("plain text");

    serveDownload(text, 512, { name: "a.txt", modelContent: "file-only" });
    expect(textOf(await download("/other"))[1]).toBe(
      "Original file only: file-only. No model content available.",
    );
  });
});

describe("read_asset refusals", () => {
  it("refuses a missing link, an invalid transfer and a corrupted download", async () => {
    await stageDirectory();
    expect((await download(7)).error).toBeDefined();

    fakeNet.handler = () =>
      okReply({
        size: 2,
        file: { name: "a", size: 3, digest: "x" },
        base64: "",
      });
    expect((await download()).error).toBeDefined();

    fakeNet.handler = () =>
      okReply({
        size: 20 * 1024 * 1024,
        file: { name: "a", size: 20 * 1024 * 1024, digest: "x" },
        base64: "AA==",
      });
    expect((await download()).error).toBeDefined();

    fakeNet.handler = () =>
      okReply({
        size: 0,
        file: { name: "a", size: 4, digest: "x" },
        base64: "",
      });
    expect((await download()).error).toBeDefined();

    fakeNet.handler = () =>
      okReply({
        size: 2,
        file: { name: "a", size: 2, digest: "0".repeat(64) },
        base64: Buffer.from("ab").toString("base64"),
      });
    expect((await download()).error).toBeDefined();

    fakeNet.handler = () =>
      okReply({
        size: 1,
        file: { name: "a", size: 1, digest: sha256(Buffer.from("a")) },
        base64: Buffer.from("ab").toString("base64"),
      });
    expect((await download()).error).toBeDefined();
  });

  it("refuses a download whose workspace directory was swapped", async () => {
    const directory = await stageDirectory();
    await writeFile(
      join(world.runtime, "assets-directory.json"),
      JSON.stringify({ root: join(world.workspace, "elsewhere"), directory }),
    );
    serveDownload(PNG, 512);
    expect((await download()).error).toBeDefined();
    expect(await readdir(directory)).toEqual([]);
  });
});

describe("return_asset", () => {
  it("publishes an edited workspace file through the upload channel", async () => {
    await writeFile(
      join(world.root, "jobs", JOB, "claim.json"),
      JSON.stringify({ execution: { workspace: world.workspace } }),
    );
    const bytes = Buffer.alloc(40000, 3);
    await writeFile(join(world.workspace, "edited.bin"), bytes);
    fakeNet.handler = (envelope) =>
      envelope.request.kind === "call"
        ? okReply({ result: { ticket: "ticket-1" } })
        : okReply({ link: "/aufgaben/attachments/new" });

    const [reply] = await serve([
      call("return_asset", {
        path: "edited.bin",
        fileName: "edited.bin",
        operationId: "op-1",
      }),
    ]);

    expect(textOf(reply)).toEqual([
      JSON.stringify({ link: "/aufgaben/attachments/new" }),
    ]);
    const sent = requests();
    expect(sent[0]).toEqual({
      kind: "call",
      name: "prepare_asset_upload",
      arguments: { fileName: "edited.bin", operationId: "op-1" },
    });
    expect(
      sent.slice(1).map((request) => [request.offset, request.done]),
    ).toEqual([
      [0, false],
      [32768, true],
    ]);
  });

  it("refuses an output outside the workspace", async () => {
    await writeFile(
      join(world.root, "jobs", JOB, "claim.json"),
      JSON.stringify({ execution: { workspace: world.workspace } }),
    );
    const [reply] = await serve([
      call("return_asset", {
        path: "../secret",
        fileName: "secret",
        operationId: "op-2",
      }),
    ]);
    expect(reply.error?.code).toBe(-32603);
    expect(requests()).toEqual([]);
  });
});
