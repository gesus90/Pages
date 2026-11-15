import { expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/chat-page-presence";
import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";

import { ACTOR, pagesRequest, routeArguments } from "./route-fixture";

const services = vi.hoisted(() => ({
  conversationReader: { isMember: vi.fn(async () => true) },
  picaMobileNotifications: { readChoices: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

function heartbeat(conversationId: string | null): Request {
  return pagesRequest("/chat-page-api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionId: "b136fc61-c13c-43da-9723-c7ce3994b561",
      chatKey: conversationId === null ? null : "group:chat",
      conversationId,
    }),
  });
}

it("requires authentication and checks membership before accepting presence", async () => {
  services.picaMobileNotifications.readChoices.mockResolvedValue(
    DEFAULT_NOTIFICATION_CHOICES,
  );
  await expect(
    loader(routeArguments(pagesRequest("/chat-page-api/presence"))),
  ).rejects.toMatchObject({ status: 403 });
  await expect(action(routeArguments(heartbeat("chat")))).rejects.toMatchObject(
    { status: 403 },
  );
  services.conversationReader.isMember.mockResolvedValueOnce(false);
  const denied = await action(
    routeArguments(heartbeat("chat"), { user: ACTOR }),
  );
  expect(denied.status).toBe(403);
  const accepted = await action(
    routeArguments(heartbeat("chat"), { user: ACTOR }),
  );
  expect(accepted.status).toBe(204);
  const snapshot = await loader(
    routeArguments(pagesRequest("/chat-page-api/presence"), { user: ACTOR }),
  );
  expect(await snapshot.json()).toMatchObject({
    chatKeys: ["group:chat"],
    conversationIds: ["chat"],
  });
});

it("limits heartbeat submissions per account", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T13:00:00.000Z"));
  const user = { ...ACTOR, id: "rate-limited-account" };
  for (let index = 0; index < 120; index += 1) {
    expect(
      (await action(routeArguments(heartbeat(null), { user }))).status,
    ).toBe(204);
  }
  expect((await action(routeArguments(heartbeat(null), { user }))).status).toBe(
    429,
  );
  vi.useRealTimers();
});
