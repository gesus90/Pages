import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/chat-api";
import { ChatError } from "@/backend/error/ChatErrors";

import { OWNER, FIRST } from "../../backend/service/chat/page48-chat-fixture";

const boundaries = vi.hoisted(() => ({
  removeSelected: vi.fn(),
  compact: vi.fn(),
  size: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    chatSessionService: boundaries,
    chatContextService: boundaries,
  }),
}));
beforeEach(() => {
  vi.resetAllMocks();
});

async function call(
  input: unknown,
  options: {
    readonly origin?: string;
    readonly isAuthenticated?: boolean;
  } = {},
): Promise<Response> {
  const context = new RouterContextProvider();
  if (options.isAuthenticated !== false)
    context.set(authenticatedUserContext, OWNER);
  return action({
    request: new Request("https://pages.example/chat-api", {
      method: "POST",
      headers: { Origin: options.origin ?? "https://pages.example" },
      body: JSON.stringify(input),
    }),
    context,
    params: {},
    url: new URL("https://pages.example/chat-api"),
    pattern: "/chat-api",
  });
}

it("sends the exact UI button selection to the ownership service without any typed confirmation", async () => {
  const deletion = { deleted: [FIRST], failed: [], cleanupFailed: [] };
  boundaries.removeSelected.mockResolvedValue(deletion);
  const response = await call({ intent: "delete", sessionIds: [FIRST] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, deletion });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(boundaries.removeSelected).toHaveBeenCalledExactlyOnceWith(OWNER, [
    FIRST,
  ]);
});

it("rejects foreign origins and missing authentication before reaching UI deletion", async () => {
  expect(
    (
      await call(
        { intent: "delete", sessionIds: [FIRST] },
        { origin: "https://foreign.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        { intent: "delete", sessionIds: [FIRST] },
        { isAuthenticated: false },
      )
    ).status,
  ).toBe(403);
  expect(boundaries.removeSelected).not.toHaveBeenCalled();
});

it("maps a rejected selection to a safe failure without a success claim", async () => {
  boundaries.removeSelected.mockRejectedValue(new ChatError("sessionMissing"));
  const response = await call({ intent: "delete", sessionIds: [FIRST] });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ ok: false, error: "sessionMissing" });
});

it("routes compact and context to the signed-in person's session", async () => {
  const context = { tokens: 100, limit: null, isEstimated: true };
  boundaries.compact.mockResolvedValue({ status: "compacted", context });
  boundaries.size.mockResolvedValue(context);
  expect(
    await (await call({ intent: "compact", sessionId: FIRST })).json(),
  ).toEqual({ ok: true, compaction: { status: "compacted", context } });
  expect(
    await (await call({ intent: "context", sessionId: FIRST })).json(),
  ).toEqual({ ok: true, context });
  expect(boundaries.compact).toHaveBeenCalledExactlyOnceWith(OWNER, FIRST);
  expect(boundaries.size).toHaveBeenCalledExactlyOnceWith(OWNER, FIRST);
});
