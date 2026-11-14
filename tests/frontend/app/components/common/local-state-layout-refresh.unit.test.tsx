import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  createLocalStateLayoutAnswers,
  useLocalStateLayout,
} from "@/app/components/common/use-local-state-layout";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";

const boundary = vi.hoisted(() => ({
  revalidate: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  currentOwner: vi.fn(() => "owner"),
  isSuperseded: vi.fn(() => false),
}));
vi.mock("react-router", () => ({
  useRevalidator: () => ({ revalidate: boundary.revalidate }),
}));
vi.mock("@/app/lib/local-state/local-state-store", () => ({
  localState: boundary,
}));
vi.mock("@/app/lib/local-state/local-state-loader", () => ({
  markLocalStateRouteOpen: () => () => {},
}));

interface Answer {
  readonly owner: string;
  readonly refused?: boolean;
}

const kind: LocalStateRouteKind<Answer> = {
  schemaVersion: 1,
  isPayload: (value): value is Answer =>
    typeof value === "object" && value !== null && "owner" in value,
  ownerOf: (answer) => answer.owner,
  isRefused: (answer) => answer.refused === true,
};

beforeEach(() => {
  vi.clearAllMocks();
  boundary.currentOwner.mockReturnValue("owner");
  boundary.isSuperseded.mockReturnValue(false);
});

afterEach(() => vi.useRealTimers());

it("refreshes a kept answer and saves the current server answer", async () => {
  const loaded = {
    owner: "owner",
    localState: { state: "stale" as const, savedAt: 1 },
  };
  const answer = { owner: "owner" };
  const source = {
    route: "/workspace",
    read: vi.fn().mockResolvedValue(answer),
    answers: createLocalStateLayoutAnswers<Answer>(),
  };
  const { result } = renderHook(() =>
    useLocalStateLayout(loaded, kind, source),
  );

  await waitFor(() => expect(result.current).toBe(answer));
  expect(source.read).toHaveBeenCalledOnce();
  expect(boundary.save).toHaveBeenCalledWith(
    "owner",
    "/workspace",
    kind,
    answer,
  );
});

it("retries an unreachable endpoint and cancels future retries on unmount", async () => {
  vi.useFakeTimers();
  const loaded = {
    owner: "owner",
    localState: { state: "offline" as const, savedAt: 1 },
  };
  const source = {
    route: "/workspace",
    read: vi.fn().mockRejectedValue(new TypeError("offline")),
    answers: createLocalStateLayoutAnswers<Answer>(),
  };
  const { result, unmount } = renderHook(() =>
    useLocalStateLayout(loaded, kind, source),
  );
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(source.read).toHaveBeenCalledTimes(2);
  expect(result.current).toBe(loaded);
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(source.read).toHaveBeenCalledTimes(2);
});

it("revalidates when the refreshed answer belongs to another account", async () => {
  const loaded = {
    owner: "owner",
    localState: { state: "stale" as const, savedAt: 1 },
  };
  const source = {
    route: "/workspace",
    read: vi.fn().mockResolvedValue({ owner: "other" }),
    answers: createLocalStateLayoutAnswers<Answer>(),
  };
  const { result } = renderHook(() =>
    useLocalStateLayout(loaded, kind, source),
  );
  await waitFor(() => expect(boundary.revalidate).toHaveBeenCalledOnce());
  expect(result.current).toBe(loaded);
  expect(boundary.save).not.toHaveBeenCalled();
});

it("removes a server answer that refuses access", () => {
  const answer = { owner: "owner", refused: true };
  const source = {
    route: "/workspace",
    read: vi.fn(),
    answers: createLocalStateLayoutAnswers<Answer>(),
  };
  renderHook(() => useLocalStateLayout(answer, kind, source));
  expect(boundary.remove).toHaveBeenCalledWith("/workspace");
  expect(boundary.save).not.toHaveBeenCalled();
});
