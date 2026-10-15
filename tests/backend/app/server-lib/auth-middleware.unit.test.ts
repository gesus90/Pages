import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
  requirePermission,
  requireUserManagement,
} from "@/app/lib/auth.server";
import { PERMISSION } from "@/definition/Role";

import {
  EMPLOYEE,
  SYNTHETIC_ORIGIN,
  mustChangePasswordUser,
  sessionCookieHeader,
  thrownResponse,
} from "./request-fixtures";
import { routeArguments } from "./route-arguments";

import type { MiddlewareFunction } from "react-router";
import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  authService: { getAuthenticatedUser: vi.fn() },
  permissionService: { allows: vi.fn() },
  administrationService: { canEnter: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const next = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  next.mockResolvedValue("next-result");
  services.permissionService.allows.mockResolvedValue(true);
  services.administrationService.canEnter.mockResolvedValue(true);
});

async function sessionRequest(): Promise<Request> {
  return new Request(`${SYNTHETIC_ORIGIN}/aufgaben`, {
    headers: { Cookie: await sessionCookieHeader("token-1") },
  });
}

async function run(
  middleware: MiddlewareFunction,
  contextUser: User | null,
): Promise<unknown> {
  const args = routeArguments(await sessionRequest(), contextUser, {});

  return middleware(args, next);
}

const MIDDLEWARES: ReadonlyArray<[string, MiddlewareFunction]> = [
  ["requireAuthenticatedUser", requireAuthenticatedUser],
  ["requirePermission", requirePermission(PERMISSION.MANAGE_PROJECTS)],
  ["requireUserManagement", requireUserManagement],
];

describe.each(MIDDLEWARES)("%s identity gate", (caseName, middleware) => {
  it("sends anonymous visitors to the login and clears the stale cookie", async () => {
    services.authService.getAuthenticatedUser.mockResolvedValue(null);

    const response = await thrownResponse(run(middleware, null));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(next).not.toHaveBeenCalled();
  });

  it("holds back an account that has to change its password", async () => {
    services.authService.getAuthenticatedUser.mockResolvedValue(
      mustChangePasswordUser(),
    );

    const response = await thrownResponse(run(middleware, null));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/change-password");
    expect(next).not.toHaveBeenCalled();
    expect(services.permissionService.allows).not.toHaveBeenCalled();
    expect(services.administrationService.canEnter).not.toHaveBeenCalled();
  });

  it("continues with the session user in the route context", async () => {
    services.authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);
    const args = routeArguments(await sessionRequest(), null, {});

    expect(await middleware(args, next)).toBe("next-result");
    expect(args.context.get(authenticatedUserContext)).toBe(EMPLOYEE);
    expect(services.authService.getAuthenticatedUser).toHaveBeenCalledWith(
      "token-1",
    );
  });
});

describe("requirePermission", () => {
  it("asks the permission service about the named permission", async () => {
    services.authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);

    await run(requirePermission(PERMISSION.MANAGE_USERS), null);

    expect(services.permissionService.allows).toHaveBeenCalledExactlyOnceWith(
      EMPLOYEE,
      PERMISSION.MANAGE_USERS,
    );
  });

  it("answers 403 without continuing when the permission is missing", async () => {
    services.authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);
    services.permissionService.allows.mockResolvedValue(false);
    const args = routeArguments(await sessionRequest(), null, {});

    const response = await thrownResponse(
      Promise.resolve(
        requirePermission(PERMISSION.MANAGE_APPLICATION)(args, next),
      ),
    );

    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(args.context.get(authenticatedUserContext)).toBeNull();
  });

  it("reuses a user an earlier middleware placed in the context", async () => {
    const earlier = { ...EMPLOYEE, id: "earlier" };

    await run(requirePermission(PERMISSION.VIEW_USERS), earlier);

    expect(services.authService.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(services.permissionService.allows).toHaveBeenCalledWith(
      earlier,
      PERMISSION.VIEW_USERS,
    );
  });
});

describe("requireUserManagement", () => {
  it("answers 403 when the account may not enter user management", async () => {
    services.authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);
    services.administrationService.canEnter.mockResolvedValue(false);

    const response = await thrownResponse(run(requireUserManagement, null));

    expect(response.status).toBe(403);
    expect(services.administrationService.canEnter).toHaveBeenCalledWith(
      EMPLOYEE.id,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("checks fresh facts of the context user instead of the session", async () => {
    await run(requireUserManagement, EMPLOYEE);

    expect(services.authService.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
