import { expect, it } from "vitest";

import {
  isLiveRevalidation,
  revalidateLive,
} from "@/app/lib/live-changes/live-revalidation";

import type { ShouldRevalidateFunctionArgs } from "react-router";

it("tracks overlapping live revalidations and clears the state on rejection", async () => {
  const args: ShouldRevalidateFunctionArgs = {
    currentUrl: new URL("https://example.invalid/page"),
    nextUrl: new URL("https://example.invalid/page"),
    currentParams: {},
    nextParams: {},
    defaultShouldRevalidate: true,
  };
  let finish: () => void = () => undefined;
  const pending = revalidateLive(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(isLiveRevalidation(args)).toBe(true);
  expect(isLiveRevalidation({ ...args, formMethod: "POST" })).toBe(false);
  expect(
    isLiveRevalidation({
      ...args,
      nextUrl: new URL("https://example.invalid/other"),
    }),
  ).toBe(false);
  await expect(
    revalidateLive(async () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  expect(isLiveRevalidation(args)).toBe(true);
  finish();
  await pending;
  expect(isLiveRevalidation(args)).toBe(false);
});
