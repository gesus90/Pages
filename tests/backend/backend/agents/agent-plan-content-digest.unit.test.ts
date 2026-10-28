import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

it("hashes the JSON form of the content", () => {
  expect(planContentDigest({ a: 1 })).toBe(sha256('{"a":1}'));
});

it("hashes content without a JSON form like null", () => {
  expect(planContentDigest(undefined)).toBe(sha256("null"));
  expect(planContentDigest(undefined)).toBe(planContentDigest(null));
});
