import { beforeEach, expect, it, vi } from "vitest";

import { runRemoteAction } from "@/app/lib/remote-actions.server";
import { action } from "@/app/routes/agent-remote";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({ remoteConnectionService: {} }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
vi.mock("@/app/lib/remote-actions.server", () => ({
  runRemoteAction: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

it("runs the remote intent for the signed-in person with the read form", async () => {
  const answer = Response.json({ ok: true });
  vi.mocked(runRemoteAction).mockResolvedValue(answer);
  const request = new Request("http://pages.invalid/agents/remote", {
    body: new URLSearchParams({ intent: "check-connection" }),
    method: "POST",
  });

  const response = await action(routeArguments(request, EMPLOYEE, {}));

  expect(response).toBe(answer);
  const context = vi.mocked(runRemoteAction).mock.calls[0]?.[0];
  expect(context).toMatchObject({ services, userId: EMPLOYEE.id });
  expect(context?.formData.get("intent")).toBe("check-connection");
});

it.each([
  ["a read", new Request("http://pages.invalid/agents/remote"), EMPLOYEE, 405],
  [
    "a visitor",
    new Request("http://pages.invalid/agents/remote", { method: "POST" }),
    null,
    403,
  ],
] as const)(
  "refuses %s before any intent runs",
  async (caseName, request, user, status) => {
    const response = await thrownResponse(
      action(routeArguments(request, user, {})),
    );

    expect(response.status).toBe(status);
    expect(runRemoteAction).not.toHaveBeenCalled();
  },
);
