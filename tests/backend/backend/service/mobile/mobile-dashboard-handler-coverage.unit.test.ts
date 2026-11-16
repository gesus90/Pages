import { expect, it, vi } from "vitest";

import { PicaMobileDashboardHandler } from "@/backend/service/mobile/PicaMobileDashboardHandler";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaMobileDashboardMessage } from "@/backend/service/mobile/PicaMobileDashboardHandler";
import type { PicaMobileDashboardProvider } from "@/backend/service/mobile/PicaMobileDashboardProvider";
import type { PicaMobilePlansHost } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";

const dashboard = partial<PicaMobileDashboardMessage>({
  type: "dashboard_get",
  requestId: "dashboard",
});
const avatar = partial<PicaMobileDashboardMessage>({
  type: "avatar_get",
  requestId: "avatar",
  payload: { version: "v1" },
});

function host(): PicaMobilePlansHost {
  return partial({
    isOpen: vi.fn(() => true),
    session: vi.fn(() => ({ userId: "user" })),
    send: vi.fn(),
    reject: vi.fn(),
    rejectUnauthenticated: vi.fn(),
    acknowledge: vi.fn(),
    endSession: vi.fn(),
    reportFailure: vi.fn(),
  });
}

it("refuses requests without a provider or session", async () => {
  const connection = host();
  await new PicaMobileDashboardHandler(undefined, connection).handle(dashboard);
  expect(connection.reject).toHaveBeenCalledOnce();
  vi.mocked(connection.session).mockReturnValue(null);
  await new PicaMobileDashboardHandler(partial({}), connection).handle(avatar);
  expect(connection.rejectUnauthenticated).toHaveBeenCalledWith("avatar");
});

it("sends the dashboard and handles absent and revoked avatars", async () => {
  const connection = host();
  const readDashboard = vi
    .fn<PicaMobileDashboardProvider["readDashboard"]>()
    .mockResolvedValue(
      partial({ kind: "ready", dashboard: { name: "Dashboard" } }),
    );
  const readAvatar = vi
    .fn<PicaMobileDashboardProvider["readAvatar"]>()
    .mockResolvedValueOnce({ kind: "notFound" })
    .mockResolvedValueOnce({ kind: "sessionEnded" });
  const handler = new PicaMobileDashboardHandler(
    partial({ readDashboard, readAvatar }),
    connection,
  );
  await handler.handle(dashboard);
  expect(connection.acknowledge).toHaveBeenCalledOnce();
  expect(connection.send).toHaveBeenCalledWith(
    expect.stringContaining("Dashboard"),
  );
  await handler.handle(avatar);
  expect(connection.reject).toHaveBeenCalledOnce();
  await handler.handle(avatar);
  expect(connection.endSession).toHaveBeenCalledWith("avatar");
});

it("does not send a result after the connection closes", async () => {
  const connection = host();
  vi.mocked(connection.isOpen)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false);
  const readDashboard = vi
    .fn<PicaMobileDashboardProvider["readDashboard"]>()
    .mockResolvedValue(partial({ kind: "ready", dashboard: {} }));
  await new PicaMobileDashboardHandler(
    partial({ readDashboard }),
    connection,
  ).handle(dashboard);
  expect(connection.send).not.toHaveBeenCalled();
  expect(connection.acknowledge).not.toHaveBeenCalled();
});
