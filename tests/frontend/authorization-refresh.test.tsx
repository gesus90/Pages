// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRevalidator } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthorizationRefresh } from "@/app/components/common/use-authorization-refresh";

vi.mock("react-router", () => ({ useRevalidator: vi.fn() }));

function Harness({ version }: { readonly version: string }): null {
  useAuthorizationRefresh(version);
  return null;
}

describe("authorization refresh across devices", () => {
  const fetchRequest = vi.fn<typeof fetch>();
  const revalidate = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchRequest);
    vi.mocked(useRevalidator).mockReturnValue({ state: "idle", revalidate });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function tick(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
  }

  it("polls without caching and refreshes only changed account facts", async () => {
    fetchRequest
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "old" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "new" })));
    render(<Harness version="old" />);
    await tick();
    expect(revalidate).not.toHaveBeenCalled();
    await tick();
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledWith("/account-version", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([null, 7, {}, { other: "old" }])(
    "ignores an invalid fingerprint %j",
    async (result) => {
      fetchRequest.mockResolvedValue(new Response(JSON.stringify(result)));
      render(<Harness version="old" />);
      await tick();
      expect(revalidate).not.toHaveBeenCalled();
    },
  );

  it("revalidates authorization failures and followed login redirects", async () => {
    const redirected = new Response("login");
    Object.defineProperty(redirected, "redirected", { value: true });
    fetchRequest
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(redirected);
    render(<Harness version="old" />);
    await tick();
    await tick();
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("retries offline requests on focus and cancels polls and requests at unmount", async () => {
    fetchRequest
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ version: "old" })));
    const view = render(<Harness version="old" />);
    await tick();
    expect(revalidate).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    const signal = fetchRequest.mock.calls.at(-1)?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await tick();
    window.dispatchEvent(new Event("focus"));
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it("ignores rejection of a request cancelled by unmount", async () => {
    fetchRequest.mockImplementation(
      (_request, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const view = render(<Harness version="old" />);
    await tick();
    await act(async () => view.unmount());
    expect(revalidate).not.toHaveBeenCalled();
  });
});
