import { expect, it } from "vitest";

import { readAgentAssetUpload } from "@/app/lib/agent-asset-upload.server";

/** A raw upload request; the content length is whatever the caller states. */
function upload(body: BodyInit | null, contentLength?: string): Request {
  return new Request("https://pages.example.com/upload", {
    method: "POST",
    body,
    headers:
      contentLength === undefined ? {} : { "content-length": contentLength },
  });
}

async function read(body: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const part of body) parts.push(part);
  return Buffer.concat(parts).toString("utf8");
}

it("streams the raw body with the file name of the consumed ticket", async () => {
  const request = upload("hello pages", "11");

  const file = readAgentAssetUpload(request, "notes.txt");

  expect(file.fileName).toBe("notes.txt");
  expect(file.contentLength).toBe(11);
  expect(await read(file.body)).toBe("hello pages");
});

it("yields an empty stream when the request has no body", async () => {
  const file = readAgentAssetUpload(upload(null), "empty.txt");

  expect(await read(file.body)).toBe("");
});

it.each([
  { label: "a missing header", header: undefined },
  { label: "zero", header: "0" },
  { label: "a negative number", header: "-5" },
  { label: "text", header: "many" },
  { label: "a fraction", header: "1.5" },
  { label: "a number beyond the safe integers", header: "9007199254740993" },
])("reports an unknown length for $label", ({ header }) => {
  const file = readAgentAssetUpload(upload("x", header), "a.bin");

  expect(file.contentLength).toBeNull();
});

it("cancels the stream when the consumer stops reading early", async () => {
  let wasCancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("chunk"));
    },
    cancel() {
      wasCancelled = true;
    },
  });
  // Node requires `duplex` for a streamed request body; the DOM typings omit it.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: stream,
    duplex: "half",
  };
  const file = readAgentAssetUpload(
    new Request("https://pages.example.com/upload", init),
    "big.bin",
  );

  for await (const part of file.body) {
    expect(Buffer.from(part).toString()).toBe("chunk");
    break;
  }

  expect(wasCancelled).toBe(true);
});
