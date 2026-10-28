import { expect, it } from "vitest";

import {
  describeUploadFailure,
  readBody,
  toUploadedFile,
} from "@/app/lib/wiki-actions/wiki-upload.server";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";

  for await (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }

  return text + decoder.decode();
}

it("reads a body chunk by chunk and releases the reader", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(encoder.encode("first "));
      controller.enqueue(encoder.encode("second"));
      controller.close();
    },
  });

  expect(await collect(readBody(body))).toBe("first second");
  expect(body.locked).toBe(false);
});

it("releases the reader when the consumer stops early", async () => {
  const body = new Blob(["a", "b"]).stream();
  const chunks = readBody(body);

  await chunks.next();
  await chunks.return(undefined);

  expect(body.locked).toBe(false);
});

it("describes an upload with its body, name and length", async () => {
  const request = new Request("http://pages.invalid/wiki/upload", {
    body: "file text",
    headers: { "Content-Length": "9" },
    method: "PUT",
  });

  const file = toUploadedFile(request, "notes.txt");

  expect(file.fileName).toBe("notes.txt");
  expect(file.contentLength).toBe(9);
  expect(await collect(file.body)).toBe("file text");
});

it.each([
  ["no length", {}],
  ["a zero length", { "Content-Length": "0" }],
  ["a length that is no number", { "Content-Length": "many" }],
])("leaves the length open for %s", async (caseName, headers) => {
  const request = new Request("http://pages.invalid/wiki/upload", {
    headers,
    method: "PUT",
  });

  const file = toUploadedFile(request, "empty.txt");

  expect(file.contentLength).toBeNull();
  expect(await collect(file.body)).toBe("");
});

it.each([
  [
    "an oversized file",
    new WikiValidationError("fileTooLarge"),
    { error: "fileTooLarge", status: 413 },
  ],
  [
    "an empty file",
    new WikiValidationError("fileEmpty"),
    { error: "fileEmpty", status: 400 },
  ],
  [
    "a missing page",
    new WikiPageNotFoundError(),
    { error: "notFound", status: 404 },
  ],
  [
    "a denied page",
    new WikiAccessDeniedError(),
    { error: "forbidden", status: 403 },
  ],
])("describes %s", (caseName, error, expected) => {
  expect(describeUploadFailure(error)).toEqual(expected);
});

it("leaves failures that are not the person's doing to the caller", () => {
  expect(describeUploadFailure(new Error("disk full"))).toBeNull();
});
