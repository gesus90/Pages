import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/settings-runners";

import { accountFixture } from "../../backend/auth/account-fixture";
import { formOf } from "../actions/action-fixtures";
import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { FormFields } from "../actions/action-fixtures";

const URL_OF_RUNNERS = "http://pages.invalid/settings/runners";
const CONNECTION = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const WORKSPACE = "00000000-0000-4000-8000-000000000003";

const fakes = vi.hoisted(() => ({
  getContext: vi.fn(),
  script: vi.fn(),
  connect: vi.fn(),
  transfer: vi.fn(),
  revoke: vi.fn(),
  refreshTools: vi.fn(),
  authorize: vi.fn(),
  register: vi.fn(),
  checkAccess: vi.fn(),
  checkRunnerAccess: vi.fn(),
  handleRunnerProviderRequest: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: fakes.getContext },
    runnerSetupService: {
      script: fakes.script,
      connect: fakes.connect,
      transfer: fakes.transfer,
    },
    runnerService: {
      revoke: fakes.revoke,
      refreshTools: fakes.refreshTools,
      authorize: fakes.authorize,
    },
    runnerDeployKeyService: {
      register: fakes.register,
      checkAccess: fakes.checkAccess,
      checkRunnerAccess: fakes.checkRunnerAccess,
    },
  }),
}));
vi.mock("@/app/lib/settings-actions/settings-runner-provider.server", () => ({
  handleRunnerProviderRequest: fakes.handleRunnerProviderRequest,
}));

beforeEach(() => {
  fakes.getContext.mockResolvedValue(
    accountFixture({ userId: EMPLOYEE.id, isAdmin: true, mode: "admin" }),
  );
});

async function submit(fields: FormFields): Promise<[number, unknown]> {
  const response = await action(
    routeArguments(
      new Request(URL_OF_RUNNERS, { method: "POST", body: formOf(fields) }),
      EMPLOYEE,
      {},
    ),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return [response.status, await response.json()];
}

it("serves the setup script as a download to an administrator", async () => {
  fakes.script.mockReturnValue("#!/bin/sh\n");
  const response = await loader(
    routeArguments(new Request(URL_OF_RUNNERS), EMPLOYEE, {}),
  );
  expect(await response.text()).toBe("#!/bin/sh\n");
  expect(response.headers.get("Content-Type")).toBe(
    "text/x-shellscript; charset=utf-8",
  );
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="pages_setup.sh"',
  );
});

it("refuses the setup script without a session", async () => {
  await expect(
    loader(routeArguments(new Request(URL_OF_RUNNERS), null, {})),
  ).rejects.toThrow("Administrator mode");
  expect(fakes.script).not.toHaveBeenCalled();
});

it("checks repository access of a runner workspace", async () => {
  fakes.checkRunnerAccess.mockResolvedValue({ state: "ok" });
  expect(
    await submit({
      intent: "runner-repository-access",
      workspaceId: WORKSPACE,
    }),
  ).toEqual([
    200,
    { ok: true, intent: "runner-repository-access", result: { state: "ok" } },
  ]);
  expect(fakes.checkRunnerAccess).toHaveBeenCalledWith(EMPLOYEE.id, WORKSPACE);
});

it("registers a deploy key for a project", async () => {
  fakes.register.mockResolvedValue({ id: "key" });
  expect(
    await submit({
      intent: "deploy-key",
      projectId: PROJECT,
      publicKey: "ssh-ed25519 AAAA",
      title: "Runner",
    }),
  ).toEqual([200, { ok: true, intent: "deploy-key", result: { id: "key" } }]);
  expect(fakes.register).toHaveBeenCalledWith(EMPLOYEE.id, {
    projectId: PROJECT,
    key: "ssh-ed25519 AAAA",
    title: "Runner",
  });
});

it("checks repository access of a project", async () => {
  fakes.checkAccess.mockResolvedValue({ state: "denied" });
  expect(
    await submit({ intent: "repository-access", projectId: PROJECT }),
  ).toEqual([
    200,
    { ok: true, intent: "repository-access", result: { state: "denied" } },
  ]);
  expect(fakes.checkAccess).toHaveBeenCalledWith(EMPLOYEE.id, PROJECT);
});

it.each(["store-provider-key", "check-provider", "sync-provider"])(
  "forwards the provider intent %s",
  async (intent) => {
    fakes.handleRunnerProviderRequest.mockResolvedValue(
      Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }),
    );
    expect(await submit({ intent, connectionId: CONNECTION })).toEqual([
      200,
      { ok: true },
    ]);
    expect(fakes.handleRunnerProviderRequest).toHaveBeenCalledWith(
      expect.objectContaining({ user: EMPLOYEE }),
      CONNECTION,
    );
  },
);

it.each([
  ["revoke", fakes.revoke],
  ["refresh-tools", fakes.refreshTools],
  ["connect", fakes.connect],
])("runs the connection intent %s", async (intent, operation) => {
  operation.mockResolvedValue(undefined);
  expect(await submit({ intent, connectionId: CONNECTION })).toEqual([
    200,
    { ok: true, intent },
  ]);
  expect(operation).toHaveBeenCalledWith(EMPLOYEE.id, CONNECTION);
});

it("transfers the setup and returns the transfer details", async () => {
  fakes.transfer.mockResolvedValue({ host: "runner" });
  expect(
    await submit({ intent: "transfer", connectionId: CONNECTION }),
  ).toEqual([200, { ok: true, intent: "transfer", host: "runner" }]);
});

it("authorizes a runner and returns its grant", async () => {
  fakes.authorize.mockResolvedValue({ token: "grant" });
  expect(
    await submit({ intent: "authorize", connectionId: CONNECTION }),
  ).toEqual([200, { ok: true, intent: "authorize", token: "grant" }]);
});

it("refuses an unknown intent", async () => {
  expect(await submit({ intent: "other", connectionId: CONNECTION })).toEqual([
    400,
    { ok: false },
  ]);
});

it("answers invalid identifiers and failures with 409", async () => {
  expect(await submit({ intent: "revoke", connectionId: "nope" })).toEqual([
    409,
    { ok: false },
  ]);
  fakes.revoke.mockRejectedValue(new Error("busy"));
  expect(await submit({ intent: "revoke", connectionId: CONNECTION })).toEqual([
    409,
    { ok: false },
  ]);
});

it("refuses a role-mode administrator with 403", async () => {
  fakes.getContext.mockResolvedValue(accountFixture({ isAdmin: true }));
  expect(await submit({ intent: "revoke", connectionId: CONNECTION })).toEqual([
    403,
    { ok: false },
  ]);
  expect(fakes.revoke).not.toHaveBeenCalled();
});

it("refuses other methods before reading the form", async () => {
  const response = await thrownResponse(
    action(
      routeArguments(
        new Request(URL_OF_RUNNERS, { method: "PUT" }),
        EMPLOYEE,
        {},
      ),
    ),
  );
  expect(response.status).toBe(405);
});
