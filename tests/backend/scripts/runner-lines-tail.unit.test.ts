import { expect, it } from "vitest";

import { ProtocolLines } from "@/scripts/runner/lines.mjs";

it("ignores whitespace-only trailing records and delivers a nonempty tail", async () => {
  const received: string[] = [];
  const parser = new ProtocolLines((line) => {
    received.push(line);
  });
  await parser.receive(Buffer.from("first\n \nlast"));
  await parser.finish();
  await parser.receive(Buffer.from("  "));
  await parser.finish();
  expect(received).toEqual(["first", "last"]);
});
