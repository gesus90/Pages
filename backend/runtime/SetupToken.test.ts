import { randomBytes } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import { SetupToken } from "./SetupToken";

import type * as NodeCrypto from "node:crypto";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();

  return { ...actual, randomBytes: vi.fn() };
});

beforeEach(() => {
  vi.mocked(randomBytes).mockImplementation(() => Buffer.alloc(32, 0xfb));
});

it("creates its secret from 32 random bytes as base64url", () => {
  const token = SetupToken.create();

  expect(randomBytes).toHaveBeenCalledWith(32);
  expect(token.value).toBe(Buffer.alloc(32, 0xfb).toString("base64url"));
  expect(token.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});

it("issues a different token for different random input", () => {
  const first = SetupToken.create();
  vi.mocked(randomBytes).mockImplementation(() => Buffer.alloc(32, 0x01));
  const second = SetupToken.create();

  expect(second.value).not.toBe(first.value);
  expect(first.matches(second.value)).toBe(false);
});

it("accepts exactly its own secret", () => {
  const token = SetupToken.create();

  expect(token.matches(token.value)).toBe(true);
});

it("rejects a secret that differs in the last character", () => {
  const token = SetupToken.create();
  const lastCharacter = token.value.slice(-1) === "A" ? "B" : "A";

  expect(token.matches(`${token.value.slice(0, -1)}${lastCharacter}`)).toBe(
    false,
  );
});

it("rejects a prefix and an extended version of the secret", () => {
  const token = SetupToken.create();

  expect(token.matches(token.value.slice(0, -1))).toBe(false);
  expect(token.matches(`${token.value}x`)).toBe(false);
});

it("rejects an empty string", () => {
  expect(SetupToken.create().matches("")).toBe(false);
});

it.each([undefined, null, 42, {}, ["secret"], true])(
  "rejects the non-string candidate %j",
  (candidate) => {
    expect(SetupToken.create().matches(candidate)).toBe(false);
  },
);
