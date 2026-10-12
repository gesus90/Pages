import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { hashAgentCredential } from "@/backend/security/AgentCredential";

import {
  pairingAddress,
  pairingClient,
  pairingFixture,
} from "../helpers/a11-pairing";
import { browser } from "../helpers/mcp-authorization";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { StoredPairingRequest } from "@/backend/database/repositories/mcp/PairingRepository";

let fixture: Awaited<ReturnType<typeof pairingFixture>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
  fixture = await pairingFixture();
});

afterEach(async () => {
  await fixture.close();
  vi.useRealTimers();
});

function storedRequest(id: string, code: string): StoredPairingRequest {
  return {
    id,
    codeHash: hashAgentCredential(code),
    secretHash: hashAgentCredential("s".repeat(43)),
    clientName: "Pages MCP",
    device: "laptop",
    packageVersion: "0.1.0",
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    status: "pending",
    userId: null,
    decidedAt: null,
    name: null,
    validitySeconds: null,
    csrfHash: null,
    lastPollAt: null,
    pollInterval: 5,
  };
}

describe("pairing requests that ran out before the browser decided", () => {
  it("tells the account that opened a pending request that it expired", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);
    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "pending" });

    vi.setSystemTime(Date.now() + 600_001);

    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "expired", code: "" });
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "expired_token",
    });
  });

  it("tells an account that approved a request that it expired before collection", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);
    const view = await fixture.pairing.view(
      request.userCode,
      browser,
      pairingAddress,
    );
    await fixture.pairing.decide(
      {
        code: request.userCode,
        csrf: view.csrf,
        decision: "approve",
        name: "Workstation",
        validityDays: 1,
        confirmMatch: true,
      },
      browser,
    );
    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "approved" });

    vi.setSystemTime(Date.now() + 700_000);

    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "expired" });
    expect(await fixture.personal.list(browser.userId)).toEqual([]);
  });

  it("shows an expired request nobody opened like an unknown code", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);

    vi.setSystemTime(Date.now() + 600_001);

    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "invalid", code: "" });
    // The request is ended nevertheless, so the device learns it.
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "expired_token",
    });
  });
});

describe("pairing decisions with incomplete input", () => {
  it("refuses a decision without a valid code, form nonce or decision and keeps the request pending", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);
    const view = await fixture.pairing.view(
      request.userCode,
      browser,
      pairingAddress,
    );
    const complete = {
      code: request.userCode,
      csrf: view.csrf,
      decision: "deny",
    };

    for (const input of [
      { ...complete, code: undefined },
      { ...complete, code: "not a code" },
      { ...complete, csrf: undefined },
      { ...complete, csrf: 7 },
      { ...complete, decision: "maybe" },
      { ...complete, decision: undefined },
    ])
      await expect(
        fixture.pairing.decide(input, browser),
      ).rejects.toMatchObject({ code: "invalid_request" });

    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "pending" });
    await expect(fixture.pairing.decide(complete, browser)).resolves.toBe(
      undefined,
    );
    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "denied" });
  });
});

describe("pairing repository", () => {
  it("joins a nested transaction to the one that is open and rolls both back together", async () => {
    const repository = new PairingRepository(fixture.database);
    const kept = storedRequest("kept", "BCDFGHJK");
    const dropped = storedRequest("dropped", "LMNPQRST");

    await repository.transaction(async (outer) => {
      await outer.transaction((inner) => inner.insert(kept));
    });
    await expect(
      repository.transaction(async (outer) => {
        await outer.transaction((inner) => inner.insert(dropped));
        throw new Error("abort the outer transaction");
      }),
    ).rejects.toThrow("abort the outer transaction");

    expect(await repository.find(kept.codeHash)).toMatchObject({ id: "kept" });
    expect(await repository.find(dropped.codeHash)).toBeNull();
  });

  it("reports eligibility for a known account and nothing for an unknown one", async () => {
    const repository = new PairingRepository(fixture.database);

    expect(await repository.account(browser.userId)).toEqual({
      displayName: "Admin",
      username: "admin",
      isEligible: true,
    });
    expect(await repository.account("unknown-user")).toBeNull();
  });

  describe("with rows that cannot come from the schema", () => {
    function rowWithStatus(status: string): DatabaseValue[] {
      return [
        "id",
        "secret-hash",
        "Pages MCP",
        "laptop",
        "0.1.0",
        "1000",
        "2000",
        status,
        null,
        null,
        null,
        null,
        null,
        null,
        "5",
      ];
    }

    function databaseReturning(
      row: DatabaseValue[],
    ): Pick<Database, "query" | "execute" | "transaction"> {
      return {
        query: async () => [row],
        execute: async () => undefined,
        transaction: (work) => fixture.database.transaction(work),
      };
    }

    it.each([
      "pending",
      "approved",
      "denied",
      "cancelled",
      "consumed",
      "expired",
    ])("reads the stored state %s", async (status) => {
      const repository = new PairingRepository(
        databaseReturning(rowWithStatus(status)),
      );

      expect(await repository.find("hash")).toMatchObject({
        id: "id",
        status,
        createdAt: 1000,
        expiresAt: 2000,
        pollInterval: 5,
      });
    });

    it("refuses an unknown stored state instead of guessing one", async () => {
      const repository = new PairingRepository(
        databaseReturning(rowWithStatus("approved-by-nobody")),
      );

      await expect(repository.find("hash")).rejects.toThrow(
        "Invalid stored pairing state.",
      );
    });
  });
});
