import { describe, expect, it, vi } from "vitest";

import { applyAdministratorInput } from "@/backend/service/chat/browser/PicaBrowserTakeover";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { PicaBrowserSession } from "@/backend/service/chat/browser/PicaBrowserSession";

vi.mock("@/backend/service/chat/browser/PicaBrowserNavigation", () => ({
  checkedAddress: vi.fn(async (origins: unknown, url: string) => {
    void origins;
    return url;
  }),
  browserFailure: vi.fn((session: unknown, error: Error) => {
    void session;
    return error;
  }),
}));

function fixture(): {
  session: PicaBrowserSession;
  page: ReturnType<PicaBrowserSession["activePage"]>;
  record: ReturnType<typeof vi.fn>;
} {
  const page = partial<ReturnType<PicaBrowserSession["activePage"]>>({
    mouse: partial({ click: vi.fn(), move: vi.fn(), wheel: vi.fn() }),
    keyboard: partial({ type: vi.fn(), press: vi.fn() }),
    evaluate: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    waitForTimeout: vi.fn(),
  });
  const record = vi.fn();
  const session = partial<PicaBrowserSession>({
    currentState: "takeover",
    activePage: () => page,
    sensitivePages: new Set(),
    queue: partial({ run: async (work) => work() }),
    touch: vi.fn(),
    record,
    allowedOrigins: vi.fn().mockReturnValue({}),
  });
  return { session, page, record };
}

describe("administrator browser takeover input", () => {
  it("sends pointer, navigation and history commands to the page", async () => {
    const { session, page } = fixture();
    await applyAdministratorInput(session, { type: "click", x: 1, y: 2 });
    await applyAdministratorInput(session, {
      type: "scroll",
      x: 1,
      y: 2,
      deltaX: 3,
      deltaY: 4,
    });
    await applyAdministratorInput(session, {
      type: "navigate",
      url: "https://example.test",
    });
    for (const direction of ["back", "forward", "reload"] as const)
      await applyAdministratorInput(session, { type: "history", direction });
    expect(page.mouse.click).toHaveBeenCalledWith(1, 2, { clickCount: 1 });
    expect(page.mouse.wheel).toHaveBeenCalledWith(3, 4);
    expect(page.goto).toHaveBeenCalledWith("https://example.test", {
      waitUntil: "domcontentloaded",
    });
    expect(page.goBack).toHaveBeenCalledOnce();
    expect(page.goForward).toHaveBeenCalledOnce();
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it("marks typed pages sensitive and never records the entered text", async () => {
    const { session, page, record } = fixture();
    await applyAdministratorInput(session, { type: "text", text: "secret" });
    await applyAdministratorInput(session, { type: "key", key: "x" });
    await applyAdministratorInput(session, { type: "key", key: "Enter" });
    expect(session.sensitivePages.has(page)).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledWith(
      "admin",
      "Typed 6 character(s)",
      "completed",
    );
  });

  it("rejects input outside takeover and records action failures", async () => {
    const { session, page, record } = fixture();
    await expect(
      applyAdministratorInput(
        { ...session, currentState: "running" },
        { type: "key", key: "Enter" },
      ),
    ).rejects.toThrow();
    vi.mocked(page.keyboard.press).mockRejectedValueOnce(new Error("failed"));
    await expect(
      applyAdministratorInput(session, { type: "key", key: "Enter" }),
    ).rejects.toThrow("failed");
    expect(record).toHaveBeenCalledWith("admin", "Pressed Enter", "failed");
  });
});
