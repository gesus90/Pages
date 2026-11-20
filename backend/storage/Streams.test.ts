import { Readable } from "node:stream";

import { expect, it } from "vitest";

import { collectStream } from "./StreamBytes";
import { digestStream, StreamTooLargeError } from "./StreamDigest";

it("collects stream bytes and closes the stream", async () => {
  const stream = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
  expect(await collectStream(stream, 4)).toEqual(Buffer.from("abcd"));
  expect(stream.destroyed).toBe(true);
});

it("measures an empty stream at a zero-byte limit", async () => {
  const stream = Readable.from([]);
  expect(await digestStream(stream, 0)).toEqual({
    size: 0,
    digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    head: Buffer.alloc(0),
  });
  expect(stream.destroyed).toBe(true);
});

it("measures the complete stream and retains only its first 4096 bytes", async () => {
  const stream = Readable.from([Buffer.alloc(4096, 97), Buffer.from("b")]);
  const result = await digestStream(stream, 4097);
  expect(result.size).toBe(4097);
  expect(result.head).toEqual(Buffer.alloc(4096, 97));
  expect(result.digest).toHaveLength(64);
  expect(stream.destroyed).toBe(true);
});

it.each([collectStream, digestStream])(
  "rejects oversized streams and closes them",
  async (readStream) => {
    const stream = Readable.from([Buffer.from("abc")]);
    await expect(readStream(stream, 2)).rejects.toBeInstanceOf(
      StreamTooLargeError,
    );
    expect(stream.destroyed).toBe(true);
  },
);

it.each([collectStream, digestStream])(
  "rejects non-buffer chunks and closes the stream",
  async (readStream) => {
    const stream = Readable.from(["text"]);
    await expect(readStream(stream, 10)).rejects.toThrow("Unexpected chunk");
    expect(stream.destroyed).toBe(true);
  },
);

it.each([collectStream, digestStream])(
  "propagates a source failure after reading bytes and closes the stream",
  async (readStream) => {
    const failure = new Error("source failed");
    const stream = Readable.from(
      (async function* () {
        yield Buffer.from("partial");
        throw failure;
      })(),
    );
    await expect(readStream(stream, 100)).rejects.toBe(failure);
    expect(stream.destroyed).toBe(true);
  },
);
