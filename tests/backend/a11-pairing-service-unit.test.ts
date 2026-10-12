import { beforeEach, expect, it, vi } from "vitest";

import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { PairingService } from "@/backend/service/mcp/PairingService";

import { createAccess } from "../helpers/authorization";
import { createDatabase, createUser } from "../helpers/factories";

import type { StoredPairingRequest } from "@/backend/database/repositories/mcp/PairingRepository";

const browser = { userId: "user-1", session: "unit-session" };
const address = { socket: "127.0.0.1", forwarded: null };
const client = {
  clientName: "Pages MCP",
  device: "laptop",
  packageVersion: "0.1.0",
};
const device = { userCode: "BCDF-GHJK", deviceSecret: "s".repeat(43) };

function storedRequest(
  overrides: Partial<StoredPairingRequest> = {},
): StoredPairingRequest {
  return {
    id: "request",
    codeHash: hashAgentCredential("BCDFGHJK"),
    secretHash: hashAgentCredential(device.deviceSecret),
    clientName: client.clientName,
    device: client.device,
    packageVersion: client.packageVersion,
    createdAt: Date.now() - 10_000,
    expiresAt: Date.now() + 600_000,
    status: "pending",
    userId: null,
    decidedAt: null,
    name: null,
    validitySeconds: null,
    csrfHash: null,
    lastPollAt: null,
    pollInterval: 5,
    ...overrides,
  };
}

function setup() {
  const identities = new AgentIdentityService(
    { getById: vi.fn().mockResolvedValue(createUser()) },
    { getContext: vi.fn().mockResolvedValue(createAccess()) },
  );
  const repository = new PairingRepository(createDatabase());
  const methods = {
    maintain: vi
      .spyOn(PairingRepository.prototype, "maintain")
      .mockResolvedValue(0),
    find: vi.spyOn(PairingRepository.prototype, "find").mockResolvedValue(null),
    insert: vi
      .spyOn(PairingRepository.prototype, "insert")
      .mockResolvedValue(undefined),
    account: vi
      .spyOn(PairingRepository.prototype, "account")
      .mockResolvedValue({
        displayName: "Admin",
        username: "admin",
        isEligible: true,
      }),
    complete: vi
      .spyOn(PairingRepository.prototype, "complete")
      .mockResolvedValue(undefined),
    poll: vi
      .spyOn(PairingRepository.prototype, "poll")
      .mockResolvedValue(undefined),
    issue: vi
      .spyOn(PersonalAgentTokenRepository.prototype, "insert")
      .mockResolvedValue(undefined),
  };
  return { service: new PairingService(repository, identities), methods };
}

beforeEach(() => vi.restoreAllMocks());

it("refuses a full persisted request pool before generating or saving a code", async () => {
  const run = setup();
  run.methods.maintain.mockResolvedValue(500);
  await expect(run.service.begin(client, address)).rejects.toMatchObject({
    code: "slow_down",
    status: 429,
    retryAfter: 600,
  });
  expect(run.methods.find).not.toHaveBeenCalled();
  expect(run.methods.insert).not.toHaveBeenCalled();
});

it("bounds code collision retries and never persists a duplicate code", async () => {
  const run = setup();
  run.methods.find.mockResolvedValue(storedRequest());
  await expect(run.service.begin(client, address)).rejects.toMatchObject({
    code: "temporarily_unavailable",
    status: 503,
  });
  expect(run.methods.find).toHaveBeenCalledTimes(8);
  expect(run.methods.insert).not.toHaveBeenCalled();
});

it("retries a code collision and persists only the hashes of the successful request", async () => {
  const run = setup();
  run.methods.find.mockResolvedValueOnce(storedRequest());
  const request = await run.service.begin(client, address);
  expect(run.methods.find).toHaveBeenCalledTimes(2);
  expect(run.methods.insert).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      codeHash: hashAgentCredential(request.userCode.replaceAll("-", "")),
      secretHash: hashAgentCredential(request.deviceSecret),
      status: "pending",
    }),
  );
  expect(JSON.stringify(run.methods.insert.mock.calls)).not.toContain(
    request.deviceSecret,
  );
});

it.each([null, undefined])(
  "returns the code-entry view without querying a request for %j",
  async (code) => {
    const run = setup();
    await expect(
      run.service.view(code, browser, address),
    ).resolves.toMatchObject({
      status: "entry",
      code: "",
      account: { displayName: "Admin", username: "admin" },
    });
    expect(run.methods.find).not.toHaveBeenCalled();
  },
);

it.each([null, { displayName: "Admin", username: "admin", isEligible: false }])(
  "refuses browser access when the persisted account is unavailable: %j",
  async (account) => {
    const run = setup();
    run.methods.account.mockResolvedValue(account);
    await expect(
      run.service.view(null, browser, address),
    ).rejects.toMatchObject({
      code: "invalid_token",
      status: 401,
    });
    expect(run.methods.find).not.toHaveBeenCalled();
  },
);

it.each([
  { userId: null, name: "Connection" },
  { userId: browser.userId, name: null },
])(
  "never issues credentials for incomplete persisted approvals: %j",
  async (overrides) => {
    const run = setup();
    run.methods.find.mockResolvedValue(
      storedRequest({ status: "approved", ...overrides }),
    );
    await expect(run.service.exchange(device)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(run.methods.issue).not.toHaveBeenCalled();
    expect(run.methods.complete).not.toHaveBeenCalled();
  },
);

it.each([
  { userCode: "invalid", deviceSecret: device.deviceSecret },
  { userCode: device.userCode, deviceSecret: null },
  { userCode: device.userCode, deviceSecret: "short" },
  { userCode: device.userCode, deviceSecret: "!".repeat(43) },
])(
  "rejects malformed device requests before looking up any code: %j",
  async (input) => {
    const run = setup();
    await expect(run.service.exchange(input)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(run.methods.find).not.toHaveBeenCalled();
    expect(run.methods.issue).not.toHaveBeenCalled();
  },
);

it("does not consume an approval if token persistence fails", async () => {
  const run = setup();
  run.methods.find.mockResolvedValue(
    storedRequest({
      status: "approved",
      userId: browser.userId,
      name: "Connection",
    }),
  );
  const failure = new Error("isolated persistence failure");
  run.methods.issue.mockRejectedValue(failure);
  await expect(run.service.exchange(device)).rejects.toBe(failure);
  expect(run.methods.complete).not.toHaveBeenCalled();
});
