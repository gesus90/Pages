import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  removeOutdated:
    vi.fn<(predicate: (payload: unknown) => boolean) => Promise<void>>(),
  currentOwner: vi.fn(),
  isSuperseded: vi.fn(),
}));
vi.mock("@/app/lib/local-state/local-state-store", () => ({
  localState: state,
}));

import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
  onLocalStateAudienceChanged,
  rememberLocalStateAudience,
  whenLocalStateAudienceSettled,
} from "@/app/lib/local-state/local-state-audience";

beforeEach(() => {
  state.removeOutdated.mockResolvedValue(undefined);
  state.currentOwner.mockReturnValue("alice");
  state.isSuperseded.mockReturnValue(false);
  vi.stubGlobal("BroadcastChannel", undefined);
});

it("validates audiences and only accepts the current account and rights", async () => {
  const audience = { userId: "alice", authorizationVersion: "v1" };
  expect(isLocalStateAudience(audience)).toBe(true);
  for (const invalid of [
    null,
    {},
    { userId: "alice", authorizationVersion: 1 },
  ])
    expect(isLocalStateAudience(invalid)).toBe(false);
  rememberLocalStateAudience(audience);
  await whenLocalStateAudienceSettled();
  expect(isCurrentLocalStateAudience(audience)).toBe(true);
  expect(
    isCurrentLocalStateAudience({ ...audience, authorizationVersion: "v2" }),
  ).toBe(false);
  state.isSuperseded.mockReturnValue(true);
  expect(isCurrentLocalStateAudience(audience)).toBe(false);
  const predicate = state.removeOutdated.mock.calls.at(-1)?.[0];
  if (!predicate) throw new Error("Missing audience cleanup predicate");
  expect(
    predicate({ audience: { userId: "alice", authorizationVersion: "old" } }),
  ).toBe(true);
  expect(predicate({ audience })).toBe(false);
  expect(predicate({})).toBe(false);
  const listener = vi.fn();
  const unsubscribe = onLocalStateAudienceChanged(listener);
  unsubscribe();
  expect(listener).not.toHaveBeenCalled();
});
