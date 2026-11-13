import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
  requirePermission,
} from "@/app/lib/auth.server";
import { PermissionService } from "@/backend/auth/PermissionService";
import { loader as loadSystem } from "@/app/routes/settings-system-server";
import { loader as loadAdminApi } from "@/app/routes/settings-embed-domains";
import { PERMISSION } from "@/definition/Role";

import { accountFixture } from "../../backend/auth/account-fixture";
import { SessionWorld } from "../../backend/auth/session-service-world";
import { adminScope } from "@/backend/service/chat/admin/PicaAdminFiles";
import { routeArguments } from "./route-arguments";

import { browserWorld } from "../../backend/service/chat/browser/page328-browser-world";

const services = vi.hoisted(() => ({
  authService: { getAuthenticatedUser: vi.fn() },
  permissionService: { allows: vi.fn() },
  administrationService: { getContext: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("opens /settings as the issued account and rejects the cookie after the job ends", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const auth = new SessionWorld();
  auth.sessions.setAgentBrowsers(world.sessions);
  services.authService.getAuthenticatedUser.mockImplementation(
    (token: string) => auth.sessions.authenticate(token),
  );
  const cookie = lease.storage.cookies[0];
  const request = new Request("http://127.0.0.1:3000/settings", {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  const args = routeArguments(request, null, {});
  const next = vi.fn(async () => new Response("settings"));

  await requireAuthenticatedUser(args, next);
  expect(next).toHaveBeenCalledOnce();
  expect(args.context.get(authenticatedUserContext)).toEqual(world.user);
  expect(args.context.get(authenticatedUserContext)?.isAgent).toBe(true);

  await world.sessions.release(adminScope(world.context));
  await expect(
    requireAuthenticatedUser(routeArguments(request, null, {}), next),
  ).rejects.toMatchObject({ status: 302 });
  expect(next).toHaveBeenCalledOnce();
});

it("returns 403 from an admin page, admin API and admin middleware for the authenticated agent", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const cookie = lease.storage.cookies[0];
  const auth = new SessionWorld();
  auth.sessions.setAgentBrowsers(world.sessions);
  services.authService.getAuthenticatedUser.mockImplementation(
    (token: string) => auth.sessions.authenticate(token),
  );
  services.administrationService.getContext.mockResolvedValue({
    ...accountFixture({ userId: world.user.id }),
    isAgent: true,
  });
  services.permissionService.allows.mockImplementation(
    (...parameters: Parameters<PermissionService["allows"]>) =>
      new PermissionService().allows(...parameters),
  );
  const request = new Request("http://127.0.0.1:3000/settings/system", {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  const args = routeArguments(request, null, {});
  await requireAuthenticatedUser(
    args,
    vi.fn(async () => new Response()),
  );
  expect(args.context.get(authenticatedUserContext)?.id).toBe(world.user.id);

  await expect(loadSystem(args)).rejects.toMatchObject({ status: 403 });
  await expect(loadAdminApi(args)).rejects.toMatchObject({ status: 403 });
  const next = vi.fn();
  await expect(
    requirePermission(PERMISSION.MANAGE_APPLICATION)(args, next),
  ).rejects.toMatchObject({ status: 403 });
  expect(next).not.toHaveBeenCalled();
  await world.sessions.close();
});

vi.mock(
  "node:fs/promises",
  async () =>
    (await import("../../backend/service/chat/browser/page328-browser-files"))
      .runtimeFiles,
);
