import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupPagesFiles,
  modelAssetContent,
  preparePagesFiles,
} from "@/scripts/runner/pages.mjs";

import { fakeNet, okReply, type PagesEnvelope } from "./runner-pages-net-fake";

vi.mock("node:net", async () =>
  (await import("./runner-pages-net-fake")).netModule(),
);

const JOB = "0b9f6a52-3f0c-4a55-9d8e-6a1a8f6c2d11";
const CHUNK_BYTES = 512 * 1024;

interface Layout {
  readonly root: string;
  readonly workspace: string;
  readonly folder: string;
}

let layout: Layout;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function descriptor(
  name: string,
  bytes: Buffer,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    parameter: "files",
    name,
    type: "text/plain",
    size: bytes.length,
    digest: sha256(bytes),
    representation: "original",
    ...overrides,
  };
}

/** Serves the manifest and the chunks of the given files like the Pages relay. */
function servePages(
  files: readonly Record<string, unknown>[],
  contents: readonly Buffer[],
): void {
  fakeNet.handler = (envelope: PagesEnvelope) => {
    const { request } = envelope;
    if (request.kind === "prepare") return okReply({ files });
    const bytes = contents[request.index as number];
    const offset = request.offset as number;
    return okReply({
      size: bytes.length,
      base64: bytes.subarray(offset, offset + CHUNK_BYTES).toString("base64"),
    });
  };
}

function command(kind: "model" | "cli"): {
  workspace: string;
  program: { kind: string; prompt: string };
} {
  return {
    workspace: layout.workspace,
    program: { kind, prompt: "Solve it." },
  };
}

function prepare(
  kind: "model" | "cli" = "cli",
  signal = new AbortController().signal,
): ReturnType<typeof preparePagesFiles> {
  return preparePagesFiles(command(kind), layout.folder, JOB, signal);
}

async function assetsDirectory(): Promise<string | undefined> {
  const entries = await readdir(layout.workspace);
  return entries.find((entry) => entry.startsWith(".pages-assets-"));
}

beforeEach(async () => {
  fakeNet.reset();
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "pages-files-unit-")),
  );
  const workspace = join(root, "workspace");
  const folder = join(root, "jobs", JOB);
  await mkdir(workspace, { recursive: true });
  await mkdir(join(folder, "runtime"), { recursive: true });
  layout = { root, workspace, folder };
});

afterEach(async () => {
  await rm(layout.root, { recursive: true, force: true });
});

describe("preparePagesFiles", () => {
  it("downloads every chunk, verifies the digest and extends the prompt", async () => {
    const small = Buffer.from("hello pages");
    const large = Buffer.alloc(CHUNK_BYTES + 10, 7);
    const empty = Buffer.alloc(0);
    const files = [
      descriptor("../évil name.txt", small, { asset: "a-1" }),
      descriptor(".hidden", large),
      descriptor("", empty),
    ];
    servePages(files, [small, large, empty]);

    const prepared = await prepare("cli");

    const directory = join(layout.workspace, (await assetsDirectory()) ?? "");
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining([
        "0-évil_name.txt",
        "1-hidden",
        "2-file",
        "assets-manifest.json",
      ]),
    );
    expect(await readFile(join(directory, "0-évil_name.txt"))).toEqual(small);
    expect(await readFile(join(directory, "1-hidden"))).toEqual(large);
    const stored = JSON.parse(
      await readFile(
        join(layout.folder, "runtime", "assets-manifest.json"),
        "utf8",
      ),
    ) as { path: string }[];
    expect(stored.map((file) => basename(file.path))).toEqual([
      "0-évil_name.txt",
      "1-hidden",
      "2-file",
    ]);
    expect(
      JSON.parse(
        await readFile(
          join(layout.folder, "runtime", "assets-directory.json"),
          "utf8",
        ),
      ),
    ).toEqual({ root: layout.workspace, directory });
    expect(prepared.program.prompt).toContain("Solve it.");
    expect(prepared.program.prompt).toContain("read_parameter_file");
    expect(prepared.program.prompt).toContain('"asset":"a-1"');
    expect(prepared.workspace).toBe(layout.workspace);
  });

  it("tells a model program that assets arrive as content blocks", async () => {
    const bytes = Buffer.from("x");
    servePages([descriptor("a.txt", bytes)], [bytes]);
    const prepared = await prepare("model");
    expect(prepared.program.prompt).toContain("native content blocks");
    expect(prepared.program.prompt).not.toContain("read_parameter_file");
  });

  it("truncates a long name to 160 bytes without splitting characters", async () => {
    const bytes = Buffer.from("x");
    servePages([descriptor("ä".repeat(100) + ".txt", bytes)], [bytes]);
    await prepare();
    const directory = join(layout.workspace, (await assetsDirectory()) ?? "");
    const stored = (await readdir(directory)).find((entry) =>
      entry.startsWith("0-"),
    );
    const name = (stored ?? "").slice(2);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(160);
    expect(name).toBe("ä".repeat(80));
  });
});

describe("preparePagesFiles refusals", () => {
  it("refuses a manifest that is no list or has more than 64 files", async () => {
    fakeNet.handler = () => okReply({ files: "nope" });
    await expect(prepare()).rejects.toThrow("Invalid Pages files");
    fakeNet.handler = () => okReply({ files: new Array(65).fill({}) });
    await expect(prepare()).rejects.toThrow("Invalid Pages files");
    expect(await assetsDirectory()).toBeUndefined();
  });

  it.each([
    { label: "a missing type", overrides: { type: undefined } },
    { label: "a fractional size", overrides: { size: 1.5 } },
    { label: "a negative size", overrides: { size: -1 } },
  ])("refuses a file with $label", async ({ overrides }) => {
    const bytes = Buffer.from("x");
    servePages([descriptor("a.txt", bytes, overrides)], [bytes]);
    await expect(prepare()).rejects.toThrow("Invalid Pages file");
  });

  it("refuses files that add up to more than 512 MiB before downloading", async () => {
    const bytes = Buffer.from("x");
    servePages(
      [descriptor("big.bin", bytes, { size: 512 * 1024 * 1024 + 1 })],
      [bytes],
    );
    await expect(prepare()).rejects.toThrow("Pages file limit");
    expect(
      fakeNet.clientSockets.map(
        (socket) => JSON.parse(socket.written).request.kind,
      ),
    ).toEqual(["prepare"]);
  });

  it.each([
    {
      label: "a chunk that is larger than allowed",
      fileSize: CHUNK_BYTES + 1,
      chunkSize: CHUNK_BYTES + 1,
      servedBytes: CHUNK_BYTES + 1,
    },
    {
      label: "a chunk announcing another file size",
      fileSize: 3,
      chunkSize: 5,
      servedBytes: 3,
    },
    {
      label: "an empty chunk before the end",
      fileSize: 4,
      chunkSize: 4,
      servedBytes: 0,
    },
  ])(
    "removes the file after $label",
    async ({ fileSize, chunkSize, servedBytes }) => {
      fakeNet.handler = (envelope) =>
        envelope.request.kind === "prepare"
          ? okReply({
              files: [descriptor("a.bin", Buffer.alloc(fileSize), {})],
            })
          : okReply({
              size: chunkSize,
              base64: Buffer.alloc(servedBytes, 1).toString("base64"),
            });
      await expect(prepare()).rejects.toThrow("Invalid Pages chunk");
      const directory = join(layout.workspace, (await assetsDirectory()) ?? "");
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it("removes the file when more bytes arrive than announced", async () => {
    const bytes = Buffer.from("abcdef");
    fakeNet.handler = (envelope) =>
      envelope.request.kind === "prepare"
        ? okReply({ files: [descriptor("a.bin", bytes, { size: 4 })] })
        : okReply({ size: 4, base64: bytes.toString("base64") });
    await expect(prepare()).rejects.toThrow("Pages file overflow");
  });

  it("removes a file whose digest is not the pinned original", async () => {
    const bytes = Buffer.from("tampered");
    servePages(
      [descriptor("a.txt", bytes, { digest: "0".repeat(64) })],
      [bytes],
    );
    await expect(prepare()).rejects.toThrow("Pages file changed");
    const directory = join(layout.workspace, (await assetsDirectory()) ?? "");
    expect(await readdir(directory)).toEqual([]);
  });

  it("stops and cleans up when the step is aborted", async () => {
    const bytes = Buffer.from("x");
    servePages([descriptor("a.txt", bytes)], [bytes]);
    const controller = new AbortController();
    controller.abort(new Error("step stopped"));
    await expect(prepare("cli", controller.signal)).rejects.toThrow(
      "step stopped",
    );
    const directory = join(layout.workspace, (await assetsDirectory()) ?? "");
    expect(await readdir(directory)).toEqual([]);
  });
});

describe("cleanupPagesFiles", () => {
  async function record(value: unknown): Promise<void> {
    await writeFile(
      join(layout.folder, "runtime", "assets-directory.json"),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }

  it("does nothing when the step never prepared files", async () => {
    await expect(cleanupPagesFiles(layout.folder)).resolves.toBeUndefined();
  });

  it("removes only the directory the run created", async () => {
    const directory = join(layout.workspace, ".pages-assets-abc123");
    await mkdir(directory);
    await writeFile(join(directory, "0-a.txt"), "x");
    await record({ root: layout.workspace, directory });
    await cleanupPagesFiles(layout.folder);
    expect(await readdir(layout.workspace)).toEqual([]);
  });

  it.each([
    {
      label: "a directory outside the root",
      name: ".pages-assets-abc",
      parent: "other",
    },
    {
      label: "a directory with a foreign name",
      name: "not-ours",
      parent: "workspace",
    },
  ])("refuses $label", async ({ name, parent }) => {
    const root = layout.workspace;
    const directory = join(layout.root, parent, name);
    await mkdir(directory, { recursive: true });
    await record({ root, directory });
    await expect(cleanupPagesFiles(layout.folder)).rejects.toThrow(
      "Asset cleanup path changed",
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it("refuses a root that is reached through a link", async () => {
    const link = join(layout.root, "link");
    await symlink(layout.workspace, link);
    const directory = join(link, ".pages-assets-abc");
    await mkdir(directory);
    await record({ root: link, directory });
    await expect(cleanupPagesFiles(layout.folder)).rejects.toThrow(
      "Asset cleanup path changed",
    );
  });

  it("passes on an unreadable record", async () => {
    await record("{broken");
    await expect(cleanupPagesFiles(layout.folder)).rejects.toThrow(SyntaxError);
  });
});

async function manifest(
  entries: readonly Record<string, unknown>[],
): Promise<void> {
  await writeFile(
    join(layout.folder, "runtime", "assets-manifest.json"),
    JSON.stringify(entries),
  );
}

async function original(name: string, bytes: Buffer): Promise<string> {
  const path = join(layout.workspace, name);
  await writeFile(path, bytes);
  return path;
}

describe("modelAssetContent", () => {
  it("returns the prompt unchanged when no assets were prepared", async () => {
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).resolves.toBe("prompt");
  });

  it("rethrows an unreadable manifest", async () => {
    await writeFile(
      join(layout.folder, "runtime", "assets-manifest.json"),
      "{",
    );
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow(SyntaxError);
  });

  it("describes plain text, a PDF extract and an original-only file", async () => {
    const text = Buffer.from("héllo");
    const pdf = Buffer.from("%PDF");
    const bin = Buffer.from("binary");
    await manifest([
      {
        ...descriptor("a.txt", text),
        path: await original("a.txt", text),
      },
      {
        ...descriptor("b.pdf", pdf, {
          representation: "text-extract",
          textExtract: "extracted",
          isTruncated: true,
        }),
        path: await original("b.pdf", pdf),
      },
      {
        ...descriptor("c.bin", bin, { modelContent: "binary-only" }),
        path: await original("c.bin", bin),
      },
    ]);
    const content = (await modelAssetContent(
      layout.folder,
      "prompt",
      true,
    )) as { type: string; text: string }[];
    expect(content[0]).toEqual({ type: "text", text: "prompt" });
    expect(content.map((block) => block.text)).toEqual(
      expect.arrayContaining([
        "héllo",
        "PDF text extract; truncated=true\nextracted",
        "Original file only: binary-only. No model content available.",
      ]),
    );
    expect(content[1]?.text).not.toContain("extracted");
  });

  it("hashes a streamed original instead of reading it into the model request", async () => {
    const bytes = Buffer.from("streamed original");
    await manifest([
      {
        ...descriptor("big.bin", bytes, {
          modelContent: "too-large-for-model",
        }),
        path: await original("big.bin", bytes),
      },
    ]);
    const content = (await modelAssetContent(
      layout.folder,
      "prompt",
      true,
    )) as { text: string }[];
    expect(content).toHaveLength(3);
    expect(content[2]?.text).toBe(
      "Original file only: too-large-for-model. No model content available.",
    );
  });
});

describe("modelAssetContent integrity", () => {
  it("refuses a streamed original that was changed or is no longer itself", async () => {
    const bytes = Buffer.from("streamed original");
    const path = await original("big.bin", bytes);
    const entry = descriptor("big.bin", bytes, {
      modelContent: "too-large-for-model",
      path,
    });

    await manifest([{ ...entry, digest: "0".repeat(64) }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Original asset changed");

    await manifest([{ ...entry, size: bytes.length + 1 }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Original asset changed");

    const link = join(layout.workspace, "link.bin");
    await symlink(path, link);
    await manifest([{ ...entry, path: link }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Invalid original file");

    await manifest([{ ...entry, size: -1 }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Invalid original file");
  });

  it("refuses an inline original that is no valid file", async () => {
    const bytes = Buffer.from("inline");
    const path = await original("a.txt", bytes);
    const entry = { ...descriptor("a.txt", bytes), path };

    await manifest([{ ...entry, size: -1 }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Invalid original file");

    await manifest([{ ...entry, size: bytes.length + 1 }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Original asset changed");

    await rm(path);
    await mkdir(path);
    await manifest([{ ...entry, size: (await stat(path)).size }]);
    await expect(
      modelAssetContent(layout.folder, "prompt", true),
    ).rejects.toThrow("Original asset changed");
  });
});
