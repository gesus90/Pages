import { expect, it } from "vitest";

import { ChatFileProbe } from "@/backend/service/chat/ChatFileProbe";

async function* chunks(parts: readonly Buffer[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

it("passes through split UTF-8 while retaining the complete small file", async () => {
  const probe = new ChatFileProbe();
  const parts = [Buffer.from([0x68, 0xc3]), Buffer.from([0xa9, 0x0a])];
  const returned: Uint8Array[] = [];
  for await (const chunk of probe.observe(chunks(parts))) returned.push(chunk);
  expect(returned).toEqual(parts);
  expect(probe.facts()).toMatchObject({
    size: 4,
    head: Buffer.concat(parts),
    tail: Buffer.concat(parts),
    isText: true,
    markup: Buffer.concat(parts),
  });
});

it("rejects invalid text bytes and binary controls", async () => {
  for (const input of [Buffer.from([0xff]), Buffer.from("text\0data")]) {
    const probe = new ChatFileProbe();
    for await (const chunk of probe.observe(chunks([input])))
      expect(chunk).toEqual(input);
    expect(probe.facts().isText).toBe(false);
  }
});

it("bounds the head, tail and retained markup for a large upload", async () => {
  const probe = new ChatFileProbe();
  const first = Buffer.alloc(5 * 1024 * 1024, 65);
  const second = Buffer.alloc(5 * 1024 * 1024, 66);
  for await (const chunk of probe.observe(chunks([first, second])))
    expect(chunk.length).toBe(first.length);
  const facts = probe.facts();
  expect(facts.size).toBe(10 * 1024 * 1024);
  expect(facts.head).toEqual(Buffer.alloc(4096, 65));
  expect(facts.tail.length).toBe(8 * 1024 * 1024);
  expect(facts.tail.at(-1)).toBe(66);
  expect(facts.markup).toBeNull();
  expect(facts.isText).toBe(true);
});
