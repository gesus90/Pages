import { expect, it, vi } from "vitest";

import { generateTemporaryPassword } from "./TemporaryPassword";

import type * as NodeCrypto from "node:crypto";

const randomness = vi.hoisted(() => ({
  randomInt: vi.fn<(maximum: number) => number>(),
}));

vi.mock("node:crypto", () => ({
  randomInt: randomness.randomInt,
}));

const AMBIGUOUS_CHARACTERS = /[0O1lI]/u;

it("formats three groups of four characters separated by hyphens", () => {
  randomness.randomInt.mockReturnValue(0);

  expect(generateTemporaryPassword()).toBe("aaaa-aaaa-aaaa");
});

it("draws every character from the upper bound of the readable alphabet", () => {
  randomness.randomInt.mockImplementation((maximum: number) => maximum - 1);

  expect(generateTemporaryPassword()).toBe("9999-9999-9999");
  expect(randomness.randomInt).toHaveBeenCalledTimes(12);
  expect(
    randomness.randomInt.mock.calls.every(([maximum]) => maximum > 9),
  ).toBe(true);
});

it("uses the real random source and never emits ambiguous characters", async () => {
  const actual = await vi.importActual<typeof NodeCrypto>("node:crypto");
  randomness.randomInt.mockImplementation(actual.randomInt);

  const passwords = Array.from({ length: 200 }, () =>
    generateTemporaryPassword(),
  );

  for (const password of passwords) {
    expect(password).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/u);
    expect(AMBIGUOUS_CHARACTERS.test(password)).toBe(false);
  }
  expect(new Set(passwords).size).toBe(passwords.length);
});
