import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { PairingThrottle } from "@/backend/service/mcp/PairingThrottle";
import {
  pairingFixture,
  pairingAddress,
  pairingClient,
} from "../helpers/a11-pairing";
import { createUser } from "../helpers/factories";
import { browser } from "../helpers/mcp-authorization";

let fixture: Awaited<ReturnType<typeof pairingFixture>>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T22:00:00Z"));
  fixture = await pairingFixture();
});
afterEach(async () => {
  await fixture.close();
  vi.useRealTimers();
});

async function approve(days = 30) {
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
      validityDays: days,
      confirmMatch: true,
    },
    browser,
  );
  vi.setSystemTime(Date.now() + 5000);
  return request;
}

describe("A11.2 device authorization in temporary DuckDB", () => {
  it("migrates existing credentials as manual without changing their hashes, expiry or revocation", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    const currentHash = hashAgentCredential("m".repeat(43));
    const revokedHash = hashAgentCredential("r".repeat(43));
    const expiresAt = Date.now() + 86_400_000;
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter(({ name }) => name < "035_"),
      );
      await database.execute(
        `
        INSERT INTO personal_agent_tokens (
            id, user_id, name, token_hash, created_at, expires_at, revoked_at
        ) VALUES
            ('legacy-active', $owner, 'Active', $current, $now, $expires, NULL),
            ('legacy-revoked', $owner, 'Revoked', $revoked, $now, $expires, $now);
      `,
        {
          owner: browser.userId,
          current: currentHash,
          revoked: revokedHash,
          now: Date.now(),
          expires: expiresAt,
        },
      );
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      const repository = new PersonalAgentTokenRepository(database);
      expect(await repository.findOwner(currentHash, Date.now())).toBe(
        browser.userId,
      );
      expect(await repository.findOwner(revokedHash, Date.now())).toBeNull();
      const summaries = await repository.list(browser.userId);
      expect(summaries).toHaveLength(2);
      for (const summary of summaries)
        expect(summary).toMatchObject({
          source: "manual",
          expiresAt,
          device: null,
          lastUsedAt: null,
          rotatedAt: null,
          rotationRequestedAt: null,
        });
      expect(
        summaries.find((entry) => entry.id === "legacy-revoked")?.revokedAt,
      ).toBe(Date.now());
      expect(
        summaries.find((entry) => entry.id === "legacy-active")?.revokedAt,
      ).toBeNull();
    } finally {
      await database.close();
    }
  });

  it("creates only hashes, binds the form to its session and issues exactly once under concurrent collection", async () => {
    const request = await approve();
    const outcomes = await Promise.allSettled([
      fixture.pairing.exchange(request),
      fixture.pairing.exchange(request),
    ]);
    expect(
      outcomes.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((entry) => entry.status === "rejected"),
    ).toHaveLength(1);
    const successful = outcomes.find((entry) => entry.status === "fulfilled");
    if (!successful || successful.status !== "fulfilled")
      throw new Error("Missing credential");
    const token = successful.value;
    expect(token.expiresAt).toBe(Date.now() + 30 * 86_400_000);
    const summaries = await fixture.personal.list(browser.userId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: token.tokenId,
      source: "pairing",
      device: "laptop",
      lastUsedAt: null,
    });
    const rows = await fixture.database.query(
      "SELECT user_code_hash, device_secret_hash, csrf_hash FROM mcp_pairing_requests;",
    );
    expect(rows[0]).toEqual([
      hashAgentCredential(request.userCode.replace("-", "")),
      hashAgentCredential(request.deviceSecret),
      null,
    ]);
    const stored = await fixture.database.query(
      "SELECT token_hash FROM personal_agent_tokens;",
    );
    expect(stored).toEqual([[hashAgentCredential(token.token)]]);
    expect(
      JSON.stringify([
        summaries,
        await fixture.pairing.view(request.userCode, browser, pairingAddress),
      ]),
    ).not.toContain(token.token);
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ status: "consumed" });
    expect(
      await fixture.pairing.view(
        request.userCode,
        { ...browser, userId: "user-1", session: "other-session" },
        pairingAddress,
      ),
    ).toMatchObject({ status: "consumed" });
  });

  it("requires code comparison, the displayed nonce, the same account and the original browser session", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);
    const view = await fixture.pairing.view(
      request.userCode.toLowerCase().replace("-", " "),
      browser,
      pairingAddress,
    );
    const again = await fixture.pairing.view(
      request.userCode,
      browser,
      pairingAddress,
    );
    expect(again.csrf).toBe(view.csrf);
    const decision = {
      code: request.userCode,
      csrf: view.csrf,
      decision: "approve",
      name: "Client",
      validityDays: 30,
      confirmMatch: true,
    };
    for (const caller of [
      { ...browser, session: "different" },
      { ...browser, userId: "other" },
    ]) {
      if (caller.userId === "other")
        await fixture.userRepository.insert({
          ...createUser({ id: "other", username: "other" }),
          passwordHash: "test-only",
        });
      await expect(
        fixture.pairing.decide(decision, caller),
      ).rejects.toMatchObject({ code: "access_denied" });
    }
    await expect(
      fixture.pairing.decide({ ...decision, confirmMatch: false }, browser),
    ).rejects.toMatchObject({ code: "confirm_match_required" });
    await expect(
      fixture.pairing.decide({ ...decision, csrf: "wrong" }, browser),
    ).rejects.toMatchObject({ code: "access_denied" });
    await fixture.pairing.decide(decision, browser);
    await expect(
      fixture.pairing.decide(decision, browser),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await fixture.personal.list(browser.userId)).toEqual([]);
    expect(
      await fixture.pairing.view(
        request.userCode,
        { ...browser, userId: "other" },
        pairingAddress,
      ),
    ).toMatchObject({ status: "invalid" });
  });

  it("rejects mismatched secrets and codes without revealing client facts", async () => {
    const request = await approve();
    await expect(
      fixture.pairing.exchange({ ...request, deviceSecret: "z".repeat(43) }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(
      fixture.pairing.exchange({ ...request, userCode: "BCDF-GHJK" }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(
      await fixture.pairing.view("invalid", browser, pairingAddress),
    ).toMatchObject({ status: "invalid" });
    expect(await fixture.personal.list(browser.userId)).toEqual([]);
  });

  it.each(["deny", "cancel", "expire"])(
    "does not issue any token after %s",
    async (outcome) => {
      const request = await fixture.pairing.begin(
        pairingClient,
        pairingAddress,
      );
      const view = await fixture.pairing.view(
        request.userCode,
        browser,
        pairingAddress,
      );
      if (outcome === "deny")
        await fixture.pairing.decide(
          { code: request.userCode, csrf: view.csrf, decision: "deny" },
          browser,
        );
      if (outcome === "cancel") {
        await fixture.pairing.cancel(request);
        await fixture.pairing.cancel(request);
      }
      if (outcome === "expire") vi.setSystemTime(Date.now() + 600_000);
      await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
        code: outcome === "deny" ? "access_denied" : "expired_token",
      });
      expect(await fixture.personal.list(browser.userId)).toEqual([]);
      const state = await fixture.pairing.view(
        request.userCode,
        browser,
        pairingAddress,
      );
      expect(state.status).toBe(
        { deny: "denied", cancel: "cancelled", expire: "expired" }[outcome],
      );
    },
  );

  it("grants at least sixty seconds to collect after late approval, then expires without issuance", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);
    const view = await fixture.pairing.view(
      request.userCode,
      browser,
      pairingAddress,
    );
    vi.setSystemTime(Date.now() + 599_000);
    await fixture.pairing.decide(
      {
        code: request.userCode,
        csrf: view.csrf,
        decision: "approve",
        name: "Late",
        validityDays: 1,
        confirmMatch: true,
      },
      browser,
    );
    expect(
      await fixture.pairing.view(request.userCode, browser, pairingAddress),
    ).toMatchObject({ expiresAt: Date.now() + 60_000 });
    vi.setSystemTime(Date.now() + 60_000);
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "expired_token",
    });
    expect(await fixture.personal.list(browser.userId)).toEqual([]);
  });

  it.each([0, 1, 365])(
    "accepts validity %i and preserves the default per account",
    async (days) => {
      expect(await fixture.pairing.validity(browser.userId)).toBe(30);
      await fixture.pairing.setValidity(browser.userId, days);
      expect(await fixture.pairing.validity(browser.userId)).toBe(days);
      const request = await approve(days);
      const token = await fixture.pairing.exchange(request);
      expect(token.expiresAt).toBe(
        days === 0 ? null : Date.now() + days * 86_400_000,
      );
    },
  );

  it.each([-1, 366, 1.5, "30", null, undefined])(
    "rejects invalid validity %s",
    async (days) => {
      await expect(
        fixture.pairing.setValidity(browser.userId, days),
      ).rejects.toMatchObject({ code: "invalid_request" });
    },
  );

  it("changes active validity from issuance, isolates other owners and preserves revoked credentials", async () => {
    const token = await fixture.pairing.exchange(await approve());
    const issuedAt = Date.now();
    const revoked = await fixture.pairing.exchange(await approve());
    await fixture.personal.revoke(browser.userId, revoked.tokenId);
    await fixture.userRepository.insert({
      ...createUser({ id: "other", username: "other" }),
      passwordHash: "test-only",
    });
    const other = await fixture.personal.create("other", "Other owner", null);
    vi.setSystemTime(Date.now() + 86_400_000);
    await fixture.pairing.setValidity(browser.userId, 7);
    expect(
      (await fixture.personal.list(browser.userId)).find(
        (entry) => entry.id === token.tokenId,
      )?.expiresAt,
    ).toBe(issuedAt + 7 * 86_400_000);
    expect((await fixture.personal.list("other"))[0]?.expiresAt).toBeNull();
    expect((await fixture.personal.list("other"))[0]?.id).toBe(
      other.summary.id,
    );
    await fixture.pairing.setValidity(browser.userId, 0);
    expect(
      (await fixture.personal.list(browser.userId)).find(
        (entry) => entry.id === token.tokenId,
      )?.expiresAt,
    ).toBeNull();
    await expect(fixture.personal.verify(revoked.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("preserves expired connections and hides ended audit facts after ninety days", async () => {
    const request = await approve(1);
    const token = await fixture.pairing.exchange(request);
    vi.setSystemTime(Date.now() + 86_400_000);
    await fixture.pairing.setValidity(browser.userId, 0);
    await expect(fixture.personal.verify(token.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
    vi.setSystemTime(Date.now() + 91 * 86_400_000);
    expect(await fixture.personal.list(browser.userId)).toEqual([]);
  });

  it("rotates the current hash in place, never extends expiry, ends overlap on new use, and refuses old-hash rotation", async () => {
    const token = await fixture.pairing.exchange(await approve());
    await fixture.personal.requestRotation(browser.userId, token.tokenId);
    expect(
      await fixture.api.handle(token.token, { operation: "verify" }),
    ).toMatchObject({
      credential: { id: token.tokenId, rotationRequested: true },
    });
    const replacement = await fixture.personal.rotateCredential(token.token);
    expect(replacement.expiresAt).toBe(token.expiresAt);
    expect(await fixture.personal.verify(token.token)).toBeDefined();
    await expect(
      fixture.personal.rotateCredential(token.token),
    ).rejects.toMatchObject({ code: "invalid_token" });
    expect(await fixture.personal.verify(replacement.token)).toBeDefined();
    await expect(fixture.personal.verify(token.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect((await fixture.personal.list(browser.userId))[0]).toMatchObject({
      id: token.tokenId,
      rotatedAt: Date.now(),
      rotationRequestedAt: null,
      lastUsedAt: Date.now(),
    });
    await fixture.personal.revokeCredential(replacement.token);
    await expect(
      fixture.personal.verify(replacement.token),
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("expires the old rotation hash after five minutes and permanently revokes tokens on deactivation", async () => {
    const token = await fixture.pairing.exchange(await approve());
    await fixture.personal.rotateCredential(token.token);
    vi.setSystemTime(Date.now() + 300_000);
    await expect(fixture.personal.verify(token.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
    const next = await fixture.pairing.exchange(await approve());
    await fixture.userRepository.setActive(browser.userId, false);
    await fixture.userRepository.setActive(browser.userId, true);
    await expect(fixture.personal.verify(next.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect(
      (await fixture.personal.list(browser.userId)).every(
        (entry) => entry.status === "revoked",
      ),
    ).toBe(true);
  });

  it("keeps deactivated OAuth grants revoked and limits ended connection visibility to ninety days", async () => {
    await fixture.repository.grants().insert({
      id: "grant",
      userId: browser.userId,
      clientId: "client",
      resource: "https://mcp.invalid/mcp",
      verifiedAt: Date.now(),
      expiresAt: null,
      status: "active",
    });
    await fixture.grants.setDuration(browser.userId, null);
    await fixture.userRepository.setActive(browser.userId, false);
    await fixture.userRepository.setActive(browser.userId, true);
    expect(await fixture.repository.grants().find("grant")).toMatchObject({
      status: "revoked",
    });
    expect(
      (await fixture.grants.connections(browser.userId)).grants,
    ).toHaveLength(1);
    vi.setSystemTime(Date.now() + 90 * 86_400_000 + 1);
    expect((await fixture.grants.connections(browser.userId)).grants).toEqual(
      [],
    );
    expect((await fixture.grants.get(browser.userId)).grants).toHaveLength(1);
  });

  it("checks persisted account eligibility at decision and collection", async () => {
    const request = await approve();
    await fixture.database.execute(
      "UPDATE users SET must_change_password = 1 WHERE id = $id;",
      { id: browser.userId },
    );
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect(await fixture.personal.list(browser.userId)).toEqual([]);
  });

  it("commits polling backoff, limits request bursts and blocks the eleventh invalid browser code", async () => {
    const request = await fixture.pairing.begin(pairingClient, pairingAddress);
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "slow_down",
    });
    vi.setSystemTime(Date.now() + 10_000);
    await expect(fixture.pairing.exchange(request)).rejects.toMatchObject({
      code: "authorization_pending",
    });
    for (let index = 0; index < 4; index++)
      await fixture.pairing.begin(pairingClient, pairingAddress);
    await expect(
      fixture.pairing.begin(pairingClient, {
        ...pairingAddress,
        forwarded: "changed-proxy",
      }),
    ).rejects.toMatchObject({ status: 429, retryAfter: 60 });
    for (let index = 0; index < 10; index++)
      expect(
        await fixture.pairing.view("BCDF-GHJK", browser, pairingAddress),
      ).toMatchObject({ status: "invalid" });
    await expect(
      fixture.pairing.view("BCDF-GHJK", browser, pairingAddress),
    ).rejects.toMatchObject({ status: 429, retryAfter: 900 });
    vi.setSystemTime(Date.now() + 900_000);
    expect(
      await fixture.pairing.view(null, browser, pairingAddress),
    ).toMatchObject({ status: "entry" });
    const throttle = new PairingThrottle();
    for (let index = 0; index < 10; index++)
      throttle.started(String(index), pairingAddress, Date.now() + 600_000);
    expect(() => throttle.request(pairingAddress)).toThrow();
  });

  it("counts approved but uncollected requests towards the per-address open limit", async () => {
    const requests: Awaited<ReturnType<typeof fixture.pairing.begin>>[] = [];
    for (let index = 0; index < 10; index++) {
      if (index === 5) vi.setSystemTime(Date.now() + 61_000);
      const request = await fixture.pairing.begin(
        pairingClient,
        pairingAddress,
      );
      requests.push(request);
      const view = await fixture.pairing.view(
        request.userCode,
        browser,
        pairingAddress,
      );
      await fixture.pairing.decide(
        {
          code: view.code,
          csrf: view.csrf,
          decision: "approve",
          confirmMatch: true,
          name: "Awaiting client",
          validityDays: 30,
        },
        browser,
      );
    }
    vi.setSystemTime(Date.now() + 61_000);
    await expect(
      fixture.pairing.begin(pairingClient, pairingAddress),
    ).rejects.toMatchObject({ status: 429, retryAfter: 600 });
    await fixture.pairing.cancel(requests[0]);
    await expect(
      fixture.pairing.begin(pairingClient, pairingAddress),
    ).resolves.toMatchObject({ service: "pages" });
  });

  it("limits hourly requests and all persisted open requests, including after a process restart", async () => {
    const throttle = new PairingThrottle();
    for (let index = 0; index < 20; index++) {
      if (index % 5 === 0) vi.setSystemTime(Date.now() + 61_000);
      throttle.request(pairingAddress);
    }
    vi.setSystemTime(Date.now() + 61_000);
    expect(() => throttle.request(pairingAddress)).toThrow();
    await fixture.database.execute(
      `
      INSERT INTO mcp_pairing_requests (
          id, user_code_hash, device_secret_hash, client_name, device_label,
          package_version, created_at, expires_at, status
      )
      SELECT CAST(range AS TEXT), sha256(CAST(range AS TEXT)), 'hashed-secret', 'Client', 'device',
          '0.1.0', $now, $expiry, 'pending'
      FROM range(500);
    `,
      { now: Date.now(), expiry: Date.now() + 600_000 },
    );
    await expect(
      fixture.pairing.begin(pairingClient, pairingAddress),
    ).rejects.toMatchObject({ status: 429, retryAfter: 600 });
    vi.setSystemTime(Date.now() + 86_400_000 + 600_001);
    await expect(
      fixture.pairing.begin(pairingClient, pairingAddress),
    ).resolves.toMatchObject({ service: "pages" });
    expect(
      (await fixture.database.query("SELECT id FROM mcp_pairing_requests;"))
        .length,
    ).toBe(1);
  });

  it.each([
    { ...pairingClient, clientName: "\u0007" },
    { ...pairingClient, device: "x".repeat(101) },
    { ...pairingClient, packageVersion: "x".repeat(33) },
  ])(
    "rejects untrusted terminal control characters and oversized labels",
    async (client) => {
      await expect(
        fixture.pairing.begin(client, pairingAddress),
      ).rejects.toMatchObject({ code: "invalid_request" });
    },
  );
});
