import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as NodeFs from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>();
  return {
    ...original,
    default: original,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readSync: vi.fn(original.readSync),
  };
});

const TOKEN = `Bearer ${"a".repeat(43)}`;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const JPEG = Buffer.from([255, 216, 255, 1, 2]);
const CATALOG = '{"action":"catalog"}';

class ExitSignal extends Error {}

interface Outcome {
  readonly stdout: string;
  readonly failure: string | null;
}

let directory = "";
let written = "";
let argv: string[] = [];

beforeEach(async () => {
  await mkdir(pagesTempDirectory("pica-helper-test"), { recursive: true });
  directory = await mkdtemp(pagesTempDirectory("pica-helper-test", "case-"));
  await writeFile(path.join(directory, "helper"), "");
  await writeDescriptor(
    `{"url":"http://pages.test/tool","authorization":"${TOKEN}"}`,
  );
  written = "";
  argv = [process.argv[0] ?? "node", path.join(directory, "helper")];
  vi.spyOn(process.stdout, "write").mockImplementation((text) => {
    written += String(text);
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new ExitSignal();
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

async function writeDescriptor(text: string): Promise<void> {
  const file = path.join(directory, "invocation.json");
  await rm(file, { recursive: true, force: true });
  await writeFile(file, text, { mode: 0o600 });
  await chmod(file, 0o600);
}

function answer(body: BodyInit | null, status = 200): void {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status }));
}

async function run(...inputs: (string | undefined)[]): Promise<Outcome> {
  vi.resetModules();
  written = "";
  const previous = process.argv;
  process.argv = [...argv, ...inputs.filter((value) => value !== undefined)];
  if (inputs.length === 1 && inputs[0] === undefined) process.argv = argv;
  try {
    await import("@/backend/agents/acp/PicaClaudeHelperRuntime.mjs");
    return { stdout: written, failure: null };
  } catch (caught: unknown) {
    if (!(caught instanceof ExitSignal)) throw caught;
    return {
      stdout: written,
      failure: (JSON.parse(written) as { error: string }).error,
    };
  } finally {
    process.argv = previous;
  }
}

function image(bytes: Buffer, mimeType = "image/png"): unknown {
  return { data: bytes.toString("base64"), mimeType };
}

it.each([
  ["a missing request", undefined],
  ["an oversized request", `{"action":"catalog","a":"${"x".repeat(1048576)}"}`],
  ["invalid json", "{"],
  ["json that is no object", "[]"],
  ["a catalog request with a key", '{"action":"catalog","a":1}'],
  ["a call without a name", '{"action":"call"}'],
  ["a call with a bad name", '{"action":"call","name":"a b"}'],
  ["a call with another key", '{"action":"call","name":"a","x":1}'],
  ["an unknown action", '{"action":"x"}'],
])("refuses %s", async (label, text) => {
  expect((await run(text)).failure).toBe("INVALID_REQUEST");
});

it("refuses extra arguments", async () => {
  expect((await run(CATALOG, "more")).failure).toBe("INVALID_REQUEST");
});

it("prints the catalog answer untouched", async () => {
  answer('{"tools":[]}');
  const outcome = await run(CATALOG);
  expect(outcome.stdout).toBe('{"tools":[]}');
  const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({ action: "catalog" });
});

it("sends a call with and without arguments", async () => {
  answer('{"ok":true,"images":[],"attachments":[1]}');
  const outcome = await run('{"action":"call","name":"a_b"}');
  expect(JSON.parse(outcome.stdout)).toEqual({ ok: true });
  const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({
    action: "native_call",
    name: "a_b",
    arguments: {},
  });
  answer("{}");
  await run('{"action":"call","name":"a","arguments":{"k":1}}');
  const [, second] = vi.mocked(fetch).mock.calls[1] ?? [];
  expect(JSON.parse(String(second?.body)).arguments).toEqual({ k: 1 });
});

it("treats an answer without a body as empty", async () => {
  answer(null);
  expect((await run(CATALOG)).stdout).toBe("");
});

it("refuses an answer that is too large", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(34 * 1024 * 1024));
    },
  });
  answer(stream);
  expect((await run(CATALOG)).failure).toBe("RESPONSE_TOO_LARGE");
});

it("names the status of a failed request", async () => {
  answer("x", 500);
  expect((await run(CATALOG)).failure).toBe("TOOL_HTTP_500");
});

it("waits while the turn is pending", async () => {
  answer('{"error":"TURN_PENDING"}', 409);
  answer("done");
  expect((await run(CATALOG)).stdout).toBe("done");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([["not json"], ['{"error":"OTHER"}'], ["[]"]])(
  "refuses a conflict answer of %s",
  async (text) => {
    answer(text, 409);
    expect((await run(CATALOG)).failure).toBe("TOOL_HTTP_409");
  },
);

it("stops when the deadline has passed", async () => {
  const controller = new AbortController();
  controller.abort();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  await expect(run(CATALOG)).rejects.toThrow();
});

it("refuses answers that are no JSON object", async () => {
  answer("nope");
  expect((await run('{"action":"call","name":"a"}')).failure).toBe(
    "INVALID_RESPONSE",
  );
  answer("[]");
  expect((await run('{"action":"call","name":"a"}')).failure).toBe(
    "INVALID_RESPONSE",
  );
});

it("saves images and tells the model where they are", async () => {
  answer(JSON.stringify({ images: [image(PNG), image(JPEG, "image/jpeg")] }));
  const outcome = await run('{"action":"call","name":"a"}');
  const { images, imageNote } = JSON.parse(outcome.stdout) as {
    images: { file: string; mimeType: string }[];
    imageNote: string;
  };
  expect(images[0]?.file).toMatch(/\.png$/u);
  expect(images[1]?.file).toMatch(/\.jpg$/u);
  expect(imageNote).toContain("Read tool");
});

it("refuses more than four images", async () => {
  answer(
    JSON.stringify({ images: Array.from({ length: 5 }, () => image(PNG)) }),
  );
  expect((await run('{"action":"call","name":"a"}')).failure).toBe(
    "IMAGE_INVALID",
  );
});

it.each([
  ["a non-object", 5],
  ["data that is no string", { data: 1, mimeType: "image/png" }],
  ["another type", { data: "AAAA", mimeType: "image/gif" }],
  ["too few bytes", image(Buffer.from([1, 2, 3]))],
  ["a short png", image(Buffer.from([137, 80, 78, 71, 1]))],
  ["a png without signature", image(JPEG)],
  ["a jpeg that is a png", image(PNG, "image/jpeg")],
  ["a short jpeg", image(Buffer.from([255, 216]), "image/jpeg")],
  ["a jpeg of other start", image(Buffer.from([255, 1, 255, 1]), "image/jpeg")],
  [
    "a jpeg of other third byte",
    image(Buffer.from([255, 216, 1, 1]), "image/jpeg"),
  ],
  [
    "a too large image",
    image(Buffer.concat([JPEG, Buffer.alloc(8_000_001)]), "image/jpeg"),
  ],
])("refuses an image of %s", async (label, entry) => {
  answer(JSON.stringify({ images: [entry] }));
  expect((await run('{"action":"call","name":"a"}')).failure).toBe(
    "IMAGE_INVALID",
  );
});

it("refuses a descriptor folder that is no private folder", async () => {
  await chmod(directory, 0o755);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("refuses a descriptor folder of another owner", async () => {
  vi.spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 1);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("refuses a descriptor that is a folder", async () => {
  const file = path.join(directory, "invocation.json");
  await rm(file);
  await mkdir(file);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("refuses a descriptor with another mode", async () => {
  await chmod(path.join(directory, "invocation.json"), 0o644);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("refuses a descriptor with several links", async () => {
  await link(
    path.join(directory, "invocation.json"),
    path.join(directory, "second.json"),
  );
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("refuses a descriptor that is too large", async () => {
  await writeDescriptor(`{"url":"${"x".repeat(5000)}"}`);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("refuses a descriptor that cannot be read completely", async () => {
  const { readSync } = await import("node:fs");
  vi.mocked(readSync).mockReturnValueOnce(0);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it.each([
  ["no object", "[]"],
  ["no url", `{"authorization":"${TOKEN}"}`],
  ["no authorization", '{"url":"http://a.test/"}'],
  [
    "a bad authorization",
    '{"url":"http://a.test/","authorization":"Bearer x"}',
  ],
  ["a foreign protocol", `{"url":"ftp://a.test/","authorization":"${TOKEN}"}`],
])("refuses a descriptor with %s", async (label, text) => {
  await writeDescriptor(text);
  expect((await run(CATALOG)).failure).toBe("DESCRIPTOR_INVALID");
});

it("accepts an https descriptor and follows a linked helper", async () => {
  await writeDescriptor(
    `{"url":"https://a.test/x","authorization":"${TOKEN}"}`,
  );
  const alias = path.join(directory, "alias");
  await symlink(path.join(directory, "helper"), alias);
  argv = [argv[0] ?? "node", alias];
  answer("ok");
  expect((await run(CATALOG)).stdout).toBe("ok");
  const [target] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(target).toBe("https://a.test/x");
});
