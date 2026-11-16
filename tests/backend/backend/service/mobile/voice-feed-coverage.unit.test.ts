import { expect, it } from "vitest";

import { PicaMobileVoiceFeed } from "@/backend/service/mobile/conversations/PicaMobileVoiceFeed";

it("delivers queued and later chunks in order before ending", async () => {
  const feed = new PicaMobileVoiceFeed();
  feed.push(Buffer.from("first"));
  const reader = feed[Symbol.asyncIterator]();
  await expect(reader.next()).resolves.toMatchObject({
    value: Buffer.from("first"),
    done: false,
  });
  const waiting = reader.next();
  feed.push(Buffer.from("second"));
  await expect(waiting).resolves.toMatchObject({
    value: Buffer.from("second"),
    done: false,
  });
  feed.end();
  feed.push(Buffer.from("ignored"));
  await expect(reader.next()).resolves.toMatchObject({ done: true });
});

it("drops queued chunks and wakes a reader when the feed fails", async () => {
  const feed = new PicaMobileVoiceFeed();
  const reader = feed[Symbol.asyncIterator]();
  const waiting = reader.next();
  const failure = new Error("upload stopped");
  feed.fail(failure);
  await expect(waiting).rejects.toBe(failure);
  feed.push(Buffer.from("ignored"));
  await expect(feed[Symbol.asyncIterator]().next()).rejects.toBe(failure);
});
