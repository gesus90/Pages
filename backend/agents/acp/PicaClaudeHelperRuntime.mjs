/* Pages-owned helper of the Pica chat for Claude Code. It makes exactly one
   authenticated request to the Pages tool route and never runs another process.
   The descriptor lies next to this file in a directory only Pages could create. */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const MAXIMUM_REQUEST_BYTES = 1048576;
const MAXIMUM_RESPONSE_BYTES = 4 * 8000000 + MAXIMUM_REQUEST_BYTES;
const MAXIMUM_DESCRIPTOR_BYTES = 4096;
const DEADLINE_MS = 15000;
const PENDING_DELAY_MS = 100;
const IMAGE_DIRECTORY = "/tmp/pages-pica-images";
const NAME = /^[A-Za-z0-9_-]{1,100}$/u;
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function fail(code) {
  process.stdout.write(
    JSON.stringify({ ok: false, result: null, error: code }),
  );
  process.exit(1);
}

function request(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > MAXIMUM_REQUEST_BYTES
  )
    fail("INVALID_REQUEST");
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    return fail("INVALID_REQUEST");
  }
  if (!record(input)) return fail("INVALID_REQUEST");
  const keys = Object.keys(input);
  if (input.action === "catalog" && keys.length === 1)
    return { action: "catalog" };
  if (
    input.action === "call" &&
    typeof input.name === "string" &&
    NAME.test(input.name) &&
    keys.every((key) => ["action", "name", "arguments"].includes(key))
  )
    return {
      action: "native_call",
      name: input.name,
      arguments: input.arguments ?? {},
    };
  return fail("INVALID_REQUEST");
}

function descriptor() {
  const directory = path.dirname(realpathSync(process.argv[1]));
  const file = path.join(directory, "invocation.json");
  const owner = process.getuid?.();
  const directoryFacts = lstatSync(directory);
  if (
    !directoryFacts.isDirectory() ||
    directoryFacts.uid !== owner ||
    (directoryFacts.mode & 0o777) !== 0o700
  )
    fail("DESCRIPTOR_INVALID");
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const facts = fstatSync(handle);
    if (
      !facts.isFile() ||
      facts.nlink !== 1 ||
      facts.uid !== owner ||
      (facts.mode & 0o777) !== 0o600 ||
      facts.size > MAXIMUM_DESCRIPTOR_BYTES
    )
      fail("DESCRIPTOR_INVALID");
    const bytes = Buffer.alloc(facts.size);
    if (readSync(handle, bytes, 0, bytes.length, 0) !== bytes.length)
      fail("DESCRIPTOR_INVALID");
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (
      !record(parsed) ||
      typeof parsed.url !== "string" ||
      typeof parsed.authorization !== "string" ||
      !/^Bearer [A-Za-z0-9_-]{43}$/u.test(parsed.authorization)
    )
      fail("DESCRIPTOR_INVALID");
    const url = new URL(parsed.url);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      fail("DESCRIPTOR_INVALID");
    return { url: url.href, authorization: parsed.authorization };
  } finally {
    closeSync(handle);
  }
}

async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAXIMUM_RESPONSE_BYTES) fail("RESPONSE_TOO_LARGE");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function send(target, body) {
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  for (;;) {
    deadline.throwIfAborted();
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        Authorization: target.authorization,
        "Content-Type": "application/json",
      },
      body,
      redirect: "error",
      signal: deadline,
    });
    const text = await readBounded(response);
    if (response.status !== 409) {
      if (!response.ok) fail(`TOOL_HTTP_${response.status}`);
      return text;
    }
    let pending;
    try {
      pending = JSON.parse(text);
    } catch {
      return fail("TOOL_HTTP_409");
    }
    if (!record(pending) || pending.error !== "TURN_PENDING")
      fail("TOOL_HTTP_409");
    await delay(PENDING_DELAY_MS, undefined, { signal: deadline });
  }
}

function saveImage(image) {
  if (
    !record(image) ||
    typeof image.data !== "string" ||
    !["image/png", "image/jpeg"].includes(image.mimeType)
  )
    fail("IMAGE_INVALID");
  const bytes = Buffer.from(image.data, "base64");
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  if (
    bytes.length < 4 ||
    bytes.length > 8000000 ||
    (image.mimeType === "image/png" ? !isPng : !isJpeg)
  )
    fail("IMAGE_INVALID");
  mkdirSync(IMAGE_DIRECTORY, { recursive: true, mode: 0o700 });
  const file = path.join(
    IMAGE_DIRECTORY,
    `${randomUUID()}.${image.mimeType === "image/png" ? "png" : "jpg"}`,
  );
  writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
  return { file, mimeType: image.mimeType };
}

function present(text) {
  let outcome;
  try {
    outcome = JSON.parse(text);
  } catch {
    return fail("INVALID_RESPONSE");
  }
  if (!record(outcome)) return fail("INVALID_RESPONSE");
  // Attachment metadata is for Pages alone; the model receives neither it nor the image bytes.
  const answer = Object.fromEntries(
    Object.entries(outcome).filter(
      ([key]) => key !== "images" && key !== "attachments",
    ),
  );
  const { images } = outcome;
  if (!Array.isArray(images) || images.length === 0)
    return JSON.stringify(answer);
  if (images.length > 4) fail("IMAGE_INVALID");
  return JSON.stringify({
    ...answer,
    images: images.map(saveImage),
    imageNote: "Open each listed image file with the Read tool to see it.",
  });
}

const input = request(process.argv[2]);
if (process.argv.length !== 3) fail("INVALID_REQUEST");
const text = await send(descriptor(), JSON.stringify(input));
process.stdout.write(input.action === "catalog" ? text : present(text));
