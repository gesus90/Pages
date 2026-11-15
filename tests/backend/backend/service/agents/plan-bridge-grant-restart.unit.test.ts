import { describe, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { PlanBridge } from "@/backend/service/agents/bridge/PlanBridge";
import { planBridgeBearerHash } from "@/backend/service/agents/bridge/PlanBridgeGrantSeal";
import { PlanBridgeGrants } from "@/backend/service/agents/bridge/PlanBridgeGrants";

import { MemoryPlanBridgeGrantStore } from "./plan-bridge-grant-store";

import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { PlanSessionActivity } from "@/backend/service/agents/bridge/PlanBridgeGrants";
import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const CREDENTIAL = "step-credential-in-clear-text";
const GRANT = {
  runId: "run-473f1735",
  stepId: "step-04620c1d",
  instanceId: "instance-28611d8d",
  token: CREDENTIAL,
  expiresAt: 0,
};

/** The API process before and after a restart: two registries over one table. */
async function restartedWorld(
  isActive: PlanSessionActivity = async () => true,
): Promise<{
  readonly store: MemoryPlanBridgeGrantStore;
  readonly bearer: string;
  readonly restarted: PlanBridgeGrants;
}> {
  const store = new MemoryPlanBridgeGrantStore();
  const bearer = await new PlanBridgeGrants(isActive, store).open(GRANT);
  return { store, bearer, restarted: new PlanBridgeGrants(isActive, store) };
}

function onlyRow(store: MemoryPlanBridgeGrantStore): string {
  const [key] = [...store.rows.keys()];
  return key;
}

describe("plan bridge grants across a restart of the API process", () => {
  it("keeps a surviving session working with the same activity check", async () => {
    const isActive = vi.fn<PlanSessionActivity>(async () => true);
    const { bearer, restarted } = await restartedWorld(isActive);
    await expect(restarted.resolve(bearer)).resolves.toBe(CREDENTIAL);
    await expect(restarted.resolve(bearer)).resolves.toBe(CREDENTIAL);
    expect(isActive).toHaveBeenCalledTimes(2);
    expect(isActive).toHaveBeenCalledWith(GRANT);
  });

  it("stores neither the bearer nor the clear credential", async () => {
    const { store, bearer } = await restartedWorld();
    const [row] = [...store.rows.values()];
    expect(row).toMatchObject({
      bearerHash: planBridgeBearerHash(bearer),
      credentialHash: hashAgentCredential(CREDENTIAL),
      runId: GRANT.runId,
      stepId: GRANT.stepId,
      instanceId: GRANT.instanceId,
      expiresAt: 0,
    });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(bearer);
    expect(stored).not.toContain(CREDENTIAL);
  });

  it("opens a stored grant only for its own bearer and binding", async () => {
    const { store, bearer, restarted } = await restartedWorld();
    const key = onlyRow(store);
    const row = store.rows.get(key);
    if (!row) throw new Error("The grant was not stored.");
    const other = await new PlanBridgeGrants(async () => true, store).open({
      ...GRANT,
      stepId: "other",
    });
    // The row of another bearer under this bearer's hash opens nothing.
    const foreign = store.rows.get(planBridgeBearerHash(other));
    if (!foreign) throw new Error("The other grant was not stored.");
    store.rows.set(key, { ...foreign, bearerHash: key });
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
    // A row moved to another run or instance opens nothing either.
    store.rows.set(key, { ...row, runId: "another-run" });
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
    store.rows.set(key, { ...row, instanceId: "another-instance" });
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
    store.rows.set(key, { ...row, sealedToken: "c2hvcnQ" });
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
    store.rows.set(key, row);
    await expect(restarted.resolve(bearer)).resolves.toBe(CREDENTIAL);
  });

  it("refuses a bearer that was revoked before the restart", async () => {
    const store = new MemoryPlanBridgeGrantStore();
    const before = new PlanBridgeGrants(async () => true, store);
    const bearer = await before.open(GRANT);
    await before.revoke(GRANT.runId, GRANT.stepId);
    expect(store.rows.size).toBe(0);
    const restarted = new PlanBridgeGrants(async () => true, store);
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
  });

  it("refuses and removes an expired or inactive stored grant", async () => {
    const store = new MemoryPlanBridgeGrantStore();
    const isActive = vi.fn<PlanSessionActivity>(async () => false);
    const before = new PlanBridgeGrants(isActive, store);
    const expired = await before.open({ ...GRANT, expiresAt: Date.now() - 1 });
    const inactive = await before.open({ ...GRANT, stepId: "finished" });
    const restarted = new PlanBridgeGrants(isActive, store);
    await expect(restarted.resolve(expired)).resolves.toBeNull();
    expect(isActive).not.toHaveBeenCalled();
    await expect(restarted.resolve(inactive)).resolves.toBeNull();
    expect(isActive).toHaveBeenCalledTimes(1);
    expect(store.rows.size).toBe(0);
  });
});

describe("plan bridge grants restored while their step changes", () => {
  it("refuses a stored grant whose step is revoked while it is read", async () => {
    const { store, bearer, restarted } = await restartedWorld();
    const find = store.find.bind(store);
    vi.spyOn(store, "find").mockImplementationOnce(async (key) => {
      const row = await find(key);
      await restarted.revoke(GRANT.runId, GRANT.stepId);
      return row;
    });
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
    await expect(restarted.resolve(bearer)).resolves.toBeNull();
  });

  it("keeps a stored grant when another step is revoked while it is read", async () => {
    const { store, bearer, restarted } = await restartedWorld();
    const find = store.find.bind(store);
    vi.spyOn(store, "find").mockImplementationOnce(async (key) => {
      const row = await find(key);
      await restarted.revoke(GRANT.runId, "another-step");
      return row;
    });
    await expect(restarted.resolve(bearer)).resolves.toBe(CREDENTIAL);
  });

  it("answers the bridge calls of a surviving session instead of 401", async () => {
    const { bearer, restarted } = await restartedWorld();
    const identity: AgentIdentity = {
      userId: "owner",
      isAdmin: false,
      permissions: [],
      run: {
        runId: GRANT.runId,
        stepId: GRANT.stepId,
        operations: [],
        tickets: [],
        reach: "full",
      },
    };
    const api: Pick<PagesAgentApiService, "handle" | "verify"> = {
      verify: async (token) => {
        if (token !== CREDENTIAL)
          throw new McpAuthorizationError("invalid_token", 401);
        return identity;
      },
      handle: vi.fn(),
    };
    const ping = (authorization: string): ReturnType<PlanBridge["handle"]> =>
      new PlanBridge(api, restarted).handle({
        method: "POST",
        authorization,
        readBody: async () =>
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    await expect(ping(`Bearer ${bearer}`)).resolves.toMatchObject({
      status: 200,
    });
    const unknown = "A".repeat(43);
    await expect(ping(`Bearer ${unknown}`)).resolves.toEqual({
      status: 401,
      body: null,
    });
  });
});
