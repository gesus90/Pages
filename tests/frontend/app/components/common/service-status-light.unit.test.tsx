import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ServiceStatusLight } from "@/app/components/common/service-status-light";

const boundary = vi.hoisted(() => ({
  read: vi.fn<(signal: AbortSignal) => Promise<"green" | "yellow">>(),
}));
vi.mock("@/app/lib/service-status", () => ({
  readServiceStatusLight: boundary.read,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string): string => key }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  boundary.read.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it("shows a warning after polling and hides it after recovery", async () => {
  boundary.read.mockResolvedValueOnce("yellow").mockResolvedValueOnce("green");
  const { unmount } = render(<ServiceStatusLight />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("status").textContent).toBe(
    "serviceStatus.light.yellow",
  );
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.queryByRole("status")).toBeNull();
  expect(boundary.read).toHaveBeenCalledTimes(2);
  const signal = boundary.read.mock.calls[0]?.[0];
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(boundary.read).toHaveBeenCalledTimes(2);
});
