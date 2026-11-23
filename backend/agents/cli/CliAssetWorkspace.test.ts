import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  assetSession,
  cleanupSessionAssets,
  CliAssetWorkspace,
  prepareSessionAssets,
  sessionAssetWorkspace,
} from "@/backend/agents/cli/CliAssetWorkspace";

import type * as FsPromises from "node:fs/promises";
import type * as StreamDigestModule from "@/backend/storage/StreamDigest";
import type * as WikiFileTypesModule from "@/backend/service/wiki/WikiFileTypes";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

const h = vi.hoisted(() => ({
  lstat: null as null | ((file: string) => Promise<unknown>),
  digest: null as null | (() => Promise<unknown>),
  sanitize: null as null | (() => string),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (file: string) =>
      (await h.lstat?.(file)) ?? actual.lstat(file),
  };
});
vi.mock("@/backend/storage/StreamDigest", async (importOriginal) => {
  const actual = await importOriginal<typeof StreamDigestModule>();
  return {
    digestStream: async (
      ...parameters: Parameters<typeof actual.digestStream>
    ) => (await h.digest?.()) ?? actual.digestStream(...parameters),
  };
});
vi.mock("@/backend/service/wiki/WikiFileTypes", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiFileTypesModule>();
  return {
    sanitizeFileName: (name: string) =>
      h.sanitize?.() ?? actual.sanitizeFileName(name),
  };
});

type Input = Pick<AgentPlanExecutionInput, "readTicketAssets" | "beforeStart">;
type AssetRead = NonNullable<Input["readTicketAssets"]>;

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

let directory: string;

beforeEach(async () => {
  await mkdir(pagesTempDirectory("asset-workspace-test"), { recursive: true });
  directory = await mkdtemp(pagesTempDirectory("asset-workspace-test", "run-"));
});

afterEach(async () => {
  h.lstat = null;
  h.digest = null;
  h.sanitize = null;
  await rm(directory, { recursive: true, force: true });
});

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function asset(parts: object = {}): AgentTicketAssetContent {
  return fake<AgentTicketAssetContent>({
    parameter: "file",
    asset: { source: "ticket", id: "a1" },
    fileName: "note.txt",
    content: { type: "text", text: "hello" },
    ...parts,
  });
}

function streamed(text: string, parts: object = {}): AgentTicketAssetContent {
  return asset({
    open: async () => Readable.from([Buffer.from(text)]),
    original: { mimeType: "text/plain", size: text.length, digest: sha(text) },
    ...parts,
  });
}

function inputOf(
  assets: readonly AgentTicketAssetContent[],
  parts: object = {},
): Input {
  return { readTicketAssets: vi.fn(async () => assets), ...parts };
}

async function prepared(
  workspace: CliAssetWorkspace,
  assets: readonly AgentTicketAssetContent[],
): Promise<AssetRead> {
  const result = await workspace.prepare(inputOf(assets));
  if (!result.readTicketAssets) throw new Error("no reader");
  return result.readTicketAssets;
}

it("returns the input when it reads no assets", async () => {
  const input: Input = {};
  expect(await new CliAssetWorkspace(directory).prepare(input)).toBe(input);
});

it("keeps reading through an empty list", async () => {
  const beforeStart = vi.fn();
  const input = inputOf([], { beforeStart });
  const result = await new CliAssetWorkspace(directory).prepare(input);
  expect(beforeStart).toHaveBeenCalledOnce();
  expect(await result.readTicketAssets?.()).toEqual([]);
  expect(input.readTicketAssets).toHaveBeenCalledTimes(2);
  expect(await readdir(directory)).toEqual([]);
});

it("copies in-memory originals privately and hands out the copies", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const png = Buffer.from("png-bytes").toString("base64");
  const items = [
    asset({ bytes: new Uint8Array(Buffer.from("raw")), fileName: "a/b.bin" }),
    asset({
      asset: { source: "ticket", id: "a2" },
      content: { type: "image", mimeType: "image/png", base64: png },
      fileName: "image.png",
    }),
    asset({ asset: { source: "ticket", id: "a3" } }),
  ];
  const read = await prepared(workspace, items);
  const result = await read();
  expect(result.map((item) => path.basename(item.path ?? ""))).toEqual([
    "0-b.bin",
    "1-image.png",
    "2-note.txt",
  ]);
  expect(await readFile(result[0].path ?? "", "utf8")).toBe("raw");
  expect(await readFile(result[1].path ?? "", "utf8")).toBe("png-bytes");
  expect(await readFile(result[2].path ?? "", "utf8")).toBe("hello");
  expect((await stat(result[0].path ?? "")).mode & 0o777).toBe(0o600);
});

it("refuses an original that has no byte representation", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const refusal = new AgentError("parameter_asset_unavailable");
  await expect(
    prepared(workspace, [asset({ content: { type: "file", reason: "x" } })]),
  ).rejects.toEqual(refusal);
  await expect(
    prepared(workspace, [
      asset({
        content: { type: "text", text: "t", representation: "text-extract" },
      }),
    ]),
  ).rejects.toEqual(refusal);
});

it("streams a large original and proves the copy", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const read = await prepared(workspace, [streamed("large content")]);
  const [copy] = await read();
  expect(await readFile(copy.path ?? "", "utf8")).toBe("large content");
});

it("does not copy a streamed original again in a later turn", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const item = streamed("large content");
  const open = vi.fn(item.open);
  const same = { ...item, open };
  await prepared(workspace, [same]);
  await prepared(workspace, [same]);
  expect(open).toHaveBeenCalledOnce();
});

it("refuses a known streamed copy that changed", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const item = streamed("large content");
  const [first] = await (await prepared(workspace, [item]))();
  await writeFile(first.path ?? "", "tampered text");
  await expect(prepared(workspace, [item])).rejects.toBeInstanceOf(
    AgentAssetError,
  );
});

it("refuses and removes a streamed copy that differs from its measurement", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const wrongDigest = streamed("abc", {
    original: { mimeType: "t", size: 3, digest: sha("other") },
  });
  await expect(prepared(workspace, [wrongDigest])).rejects.toBeInstanceOf(
    AgentAssetError,
  );
  const wrongSize = streamed("abc", {
    original: { mimeType: "t", size: 4, digest: sha("abc") },
  });
  await expect(prepared(workspace, [wrongSize])).rejects.toBeInstanceOf(
    AgentAssetError,
  );
  const [created] = await readdir(directory);
  expect(await readdir(path.join(directory, created))).toEqual([]);
});

it("hashes a streamed original without a measurement from its bytes", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const item = asset({
    bytes: new Uint8Array(Buffer.from("x")),
    open: async () => Readable.from([Buffer.from("x")]),
  });
  await expect(prepared(workspace, [item])).rejects.toBeInstanceOf(
    AgentAssetError,
  );
});

it("refuses a stream that fails while copying", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const item = streamed("abc", {
    open: async () =>
      new Readable({
        read(): void {
          this.destroy(new Error("broken"));
        },
      }),
  });
  await expect(prepared(workspace, [item])).rejects.toThrow("broken");
});

it("reports a parameter whose copy is no longer known", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const item = asset();
  const read = await prepared(workspace, [item]);
  Reflect.set(item, "parameter", "changed");
  await expect(read()).rejects.toEqual(
    new AgentError("parameter_ticket_changed"),
  );
});

it("refuses a handed-out copy that changed", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const read = await prepared(workspace, [asset()]);
  const [copy] = await read();
  await writeFile(copy.path ?? "", "HELLO");
  await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
  await writeFile(copy.path ?? "", "hello world");
  await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
});

it("refuses a copy replaced by a link or moved aside", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const read = await prepared(workspace, [asset()]);
  const [copy] = await read();
  const original = copy.path ?? "";
  await rm(original);
  await symlink(path.join(directory, ".."), original);
  await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
  await rm(original);
  await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
});

it("refuses a copy that is not a regular file", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const read = await prepared(workspace, [asset()]);
  const [copy] = await read();
  await rm(copy.path ?? "");
  await mkdir(copy.path ?? "");
  await chmod(copy.path ?? "", 0o700);
  await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
});

it("refuses a copy whose identity or measurement changed while it was read", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const read = await prepared(workspace, [asset()]);
  const [copy] = await read();
  const real = await stat(copy.path ?? "");
  const facts = (parts: object): object => ({
    isSymbolicLink: () => false,
    ino: real.ino,
    dev: real.dev,
    ...parts,
  });
  for (const changed of [
    { isSymbolicLink: () => true },
    { ino: real.ino + 1 },
    { dev: real.dev + 1 },
  ]) {
    h.lstat = async (file) => (file === copy.path ? facts(changed) : undefined);
    await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
  }
  h.lstat = null;
  h.digest = async () => ({ size: 1, digest: sha("hello") });
  await expect(read()).rejects.toBeInstanceOf(AgentAssetError);
});

it("shortens long names to 160 bytes and falls back to a plain name", async () => {
  const workspace = new CliAssetWorkspace(directory);
  const read = await prepared(workspace, [
    asset({ fileName: `${"ä".repeat(100)}.txt` }),
  ]);
  const [long] = await read();
  expect(Buffer.byteLength(path.basename(long.path ?? ""))).toBeLessThanOrEqual(
    163,
  );
  h.sanitize = () => "";
  const [plain] = await (await prepared(workspace, [asset()]))();
  expect(path.basename(plain.path ?? "")).toBe("0-file");
});

it("removes its copies after confirmation and then needs nothing", async () => {
  const workspace = new CliAssetWorkspace(directory);
  await prepared(workspace, [streamed("abc"), asset()]);
  expect(await readdir(directory)).toHaveLength(1);
  await workspace.cleanup();
  expect(await readdir(directory)).toEqual([]);
  await workspace.cleanup();
});

it("refuses to remove a directory that was replaced", async () => {
  const workspace = new CliAssetWorkspace(directory);
  await prepared(workspace, [asset()]);
  const [created] = await readdir(directory);
  const target = path.join(directory, created);
  await rm(target, { recursive: true });
  await writeFile(target, "file");
  await expect(workspace.cleanup()).rejects.toThrow("Asset directory changed");
  await rm(target);
  await symlink(directory, target);
  await expect(workspace.cleanup()).rejects.toThrow("Asset directory changed");
});

function session(parts: object = {}): PlanSession {
  return fake<PlanSession>({
    turn: Promise.resolve({}),
    terminated: Promise.resolve(),
    close: vi.fn(async () => ({ isConfirmed: true })),
    ...parts,
  });
}

it("returns the session itself without an asset workspace", () => {
  const plain = session();
  expect(assetSession(plain, null)).toBe(plain);
});

it("forwards the optional controls of the session", async () => {
  const steer = vi.fn(async () => "steered");
  const interrupt = vi.fn(async () => true);
  const wrapped = assetSession(
    session({ steer, interrupt }),
    new CliAssetWorkspace(directory),
  );
  expect(await wrapped.steer?.([])).toBe("steered");
  expect(await wrapped.interrupt?.()).toBe(true);
  expect(wrapped.suspend).toBeUndefined();
  expect(wrapped.resume).toBeUndefined();
  expect(wrapped.cancelTool).toBeUndefined();
  expect(wrapped.next).toBeUndefined();
});

it("prepares the assets of every further turn", async () => {
  const next = vi.fn(async (input: Input) => ({ input }));
  const workspace = new CliAssetWorkspace(directory);
  const source = session({ next });
  const wrapped = assetSession(source, workspace);
  const observer = fake<Parameters<NonNullable<PlanSession["next"]>>[2]>({});
  const signal = new AbortController().signal;
  await wrapped.next?.(
    fake<AgentPlanExecutionInput>(inputOf([asset()])),
    signal,
    observer,
  );
  expect(next).toHaveBeenCalledWith(expect.anything(), signal, observer);
  expect(await readdir(directory)).toHaveLength(1);
  Reflect.set(source, "next", undefined);
  await expect(
    wrapped.next?.(fake<AgentPlanExecutionInput>({}), signal, observer),
  ).rejects.toEqual(new AgentError("plan_run_unavailable"));
});

it("keeps copies until the close is confirmed", async () => {
  const workspace = new CliAssetWorkspace(directory);
  await prepared(workspace, [asset()]);
  const close = vi
    .fn()
    .mockResolvedValueOnce({ isConfirmed: false })
    .mockResolvedValueOnce({ isConfirmed: true });
  const wrapped = assetSession(session({ close }), workspace);
  expect(await wrapped.close()).toEqual({ isConfirmed: false });
  expect(await readdir(directory)).toHaveLength(1);
  expect(await wrapped.close()).toEqual({ isConfirmed: true });
  expect(await readdir(directory)).toEqual([]);
});

it("gives a Pica chat no workspace and a plan session its own", () => {
  expect(
    sessionAssetWorkspace(fake<AgentPlanSessionInput>({ chat: {} })),
  ).toBeNull();
  expect(
    sessionAssetWorkspace(fake<AgentPlanSessionInput>({ directory })),
  ).toBeInstanceOf(CliAssetWorkspace);
});

it("prepares session assets only with a workspace", async () => {
  const input = fake<AgentPlanSessionInput>({});
  expect(await prepareSessionAssets(input, null)).toBe(input);
  expect(
    await prepareSessionAssets(input, new CliAssetWorkspace(directory)),
  ).toBe(input);
});

it("cleans session assets unless the end of the process is unconfirmed", async () => {
  const workspace = new CliAssetWorkspace(directory);
  await prepared(workspace, [asset()]);
  await cleanupSessionAssets(workspace, new AcpCleanupUnconfirmedError());
  expect(await readdir(directory)).toHaveLength(1);
  await cleanupSessionAssets(workspace, new Error("failed"));
  expect(await readdir(directory)).toEqual([]);
  await cleanupSessionAssets(null, new Error("failed"));
});
