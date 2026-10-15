import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  EMPTY_SEARCH_FORM,
  useWikiSearch,
} from "@/app/components/wiki/use-wiki-search";

import type { WikiSearchResponse } from "@/definition/Wiki";

const fetcher = vi.hoisted(() => ({
  data: undefined as WikiSearchResponse | undefined,
  state: "idle",
  load: vi.fn(),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.load.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("keeps the empty search idle even if an old response exists", () => {
  fetcher.data = { results: [], total: 0 };
  const { result } = renderHook(() => useWikiSearch(null));
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(fetcher.load).not.toHaveBeenCalled();
  expect(result.current.response).toBeNull();
  expect(result.current.isLoading).toBe(false);
});

it("debounces typing, encodes filters and cancels after unmount", () => {
  const { result, unmount } = renderHook(() => useWikiSearch("page-1"));
  act(() => result.current.setForm({ ...EMPTY_SEARCH_FORM, text: "old" }));
  act(() => {
    vi.advanceTimersByTime(249);
  });
  expect(fetcher.load).not.toHaveBeenCalled();
  act(() =>
    result.current.setForm({
      ...EMPTY_SEARCH_FORM,
      text: "A & B",
      creatorId: "editor",
      location: "project:p",
      editedFrom: "2026-10-01",
      editedTo: "2026-10-15",
      isUnderPage: true,
      titleOnly: true,
      sort: "edited",
    }),
  );
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(fetcher.load).toHaveBeenCalledExactlyOnceWith(
    "/wiki-api/search?q=A+%26+B&location=project%3Ap&under=page-1&creator=editor&from=2026-10-01&to=2026-10-15&sort=edited&titleOnly=1",
  );
  act(() =>
    result.current.setForm({ ...EMPTY_SEARCH_FORM, text: "cancelled" }),
  );
  unmount();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(fetcher.load).toHaveBeenCalledTimes(1);
});

it("exposes loading and response for a search and clears them when reset", () => {
  const { result, rerender } = renderHook(() => useWikiSearch(null));
  act(() => result.current.setForm({ ...EMPTY_SEARCH_FORM, text: "pages" }));
  fetcher.state = "loading";
  rerender();
  expect(result.current.isLoading).toBe(true);
  fetcher.data = { results: [], total: 0 };
  fetcher.state = "idle";
  rerender();
  expect(result.current.response).toEqual({ results: [], total: 0 });
  expect(result.current.isLoading).toBe(false);
  act(() => result.current.setForm(EMPTY_SEARCH_FORM));
  expect(result.current.response).toBeNull();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(fetcher.load).not.toHaveBeenCalled();
});
