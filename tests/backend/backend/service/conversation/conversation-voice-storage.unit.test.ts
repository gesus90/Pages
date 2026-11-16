import { describe, expect, it, vi } from "vitest";

import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";

import type { WriteOptions } from "@/backend/storage/WikiFileStore";

function fixture(bytes: Buffer): {
  store: ConversationVoiceStore;
  write: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(
    async (source: AsyncIterable<Uint8Array>, options: WriteOptions) => {
      void source;
      options.limitFor(bytes);
      return { storageName: "file", size: bytes.length, checksum: "checksum" };
    },
  );
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    store: new ConversationVoiceStore({ write, remove }, 1000),
    write,
    remove,
  };
}

describe("conversation voice storage", () => {
  it("validates MIME declarations and duration", () => {
    const { store } = fixture(Buffer.from("ID3audio"));
    expect(store.declare({ mimeType: "audio/mpeg", durationMs: 500 })).toEqual({
      format: "mp3",
      durationMs: 500,
    });
    expect(() =>
      store.declare({ mimeType: "text/plain", durationMs: 1 }),
    ).toThrow();
    expect(() =>
      store.declare({ mimeType: "audio/mpeg", durationMs: 0 }),
    ).toThrow();
    expect(() =>
      store.declare({ mimeType: "audio/mpeg", durationMs: 1001 }),
    ).toThrow();
  });

  it("stores matching audio and removes refused files", async () => {
    const { store, remove } = fixture(Buffer.from("ID3audio"));
    const source = (async function* () {
      yield Buffer.from("audio");
    })();
    const file = await store.store({ format: "mp3", durationMs: 500 }, source);
    expect(file).toEqual({
      storageName: "file",
      mimeType: "audio/mpeg",
      sizeBytes: 8,
      durationMs: 500,
    });
    await store.discard(file);
    await expect(
      store.store({ format: "wav", durationMs: 500 }, source),
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("maps a file size error to a safe conversation failure", async () => {
    const { store, write } = fixture(Buffer.alloc(0));
    write.mockRejectedValueOnce(new FileTooLargeError());
    const source = (async function* () {
      yield Buffer.alloc(0);
    })();
    await expect(
      store.store({ format: "wav", durationMs: 1 }, source),
    ).rejects.toMatchObject({ code: "too_large" });
  });
});
