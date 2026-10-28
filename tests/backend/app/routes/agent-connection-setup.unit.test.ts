import { beforeEach, expect, it, vi } from "vitest";

import { remoteConsoleAction } from "@/app/lib/remote-console-route.server";
import { action } from "@/app/routes/agent-connection-setup";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));
vi.mock("@/app/lib/remote-console-route.server", () => ({
  remoteConsoleAction: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

it("hands the request, the signed-in person and the setup scope to the console", async () => {
  const answer = Response.json({ ok: true });
  vi.mocked(remoteConsoleAction).mockResolvedValue(answer);
  const request = new Request("http://pages.invalid/console", {
    method: "POST",
  });

  const response = await action(
    routeArguments(request, EMPLOYEE, { connectionId: "target-1" }),
  );

  expect(response).toBe(answer);
  expect(remoteConsoleAction).toHaveBeenCalledExactlyOnceWith({
    request,
    user: EMPLOYEE,
    scope: { kind: "setup", id: "target-1" },
  });
});

it("passes a missing person on, so the console refuses it", async () => {
  vi.mocked(remoteConsoleAction).mockResolvedValue(
    new Response(null, { status: 403 }),
  );
  const request = new Request("http://pages.invalid/console", {
    method: "POST",
  });

  const response = await action(
    routeArguments(request, null, { connectionId: "target-1" }),
  );

  expect(response.status).toBe(403);
  expect(remoteConsoleAction).toHaveBeenCalledWith(
    expect.objectContaining({ user: null }),
  );
});
