import path from "node:path";

import { expect, it } from "vitest";

import { localInstanceKey } from "@/backend/agents/local/LocalSessionIdentity";

it("derives a stable hex key from the token key and the resolved config path", () => {
  const key = Buffer.from("token-key");
  const first = localInstanceKey(key, "/srv/pages/config.json");
  expect(first).toMatch(/^[a-f0-9]{64}$/u);
  expect(localInstanceKey(key, "/srv/pages/../pages/config.json")).toBe(first);
  expect(localInstanceKey(key, path.resolve("relative.json"))).toBe(
    localInstanceKey(key, "relative.json"),
  );
});

it("differs for another token key or config path", () => {
  const key = Buffer.from("token-key");
  const base = localInstanceKey(key, "/a.json");
  expect(localInstanceKey(Buffer.from("other"), "/a.json")).not.toBe(base);
  expect(localInstanceKey(key, "/b.json")).not.toBe(base);
});
