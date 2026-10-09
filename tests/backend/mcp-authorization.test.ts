import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAPABILITY } from "@/definition/Authorization";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { OAuthClientService } from "@/backend/service/mcp/OAuthClientService";
import { OAuthGrantRepository } from "@/backend/database/repositories/mcp/OAuthGrantRepository";
import { parseAuthorizationRequest } from "@/backend/service/mcp/OAuthConsentService";
import {
  readOAuthConfiguration,
  authorizationMetadata,
} from "@/backend/service/mcp/OAuthConfiguration";
import { parseOAuthClient, isRedirectUri } from "@/definition/McpOAuthClient";
import { createAccess } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import {
  authorizationFixture,
  authorizationParameters,
  browser,
  clientMetadata,
  issueCode,
  testOAuthConfiguration,
} from "../helpers/mcp-authorization";

let fixture: Awaited<ReturnType<typeof authorizationFixture>>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T21:00:00Z"));
  fixture = await authorizationFixture();
});
afterEach(async () => {
  await fixture.database.close();
  vi.useRealTimers();
});

describe("personal stdio credentials", () => {
  it("shows a named token once, stores only a hash, rotates without overlap and records revocation", async () => {
    const created = await fixture.personal.create(
      browser.userId,
      "  workstation  ",
      Date.now() + 100_000,
    );
    expect(created.summary).toMatchObject({
      name: "workstation",
      status: "active",
    });
    const rows = await fixture.database.query(
      "SELECT token_hash FROM personal_agent_tokens;",
    );
    expect(rows).toEqual([[hashAgentCredential(created.token)]]);
    const summaries = await fixture.personal.list(browser.userId);
    expect(JSON.stringify(summaries)).not.toContain(created.token);
    expect(JSON.stringify(summaries)).not.toContain(
      hashAgentCredential(created.token),
    );
    await expect(fixture.personal.verify(created.token)).resolves.toMatchObject(
      { userId: browser.userId },
    );
    await fixture.personal.revoke("someone-else", created.summary.id);
    await expect(fixture.personal.verify(created.token)).resolves.toBeDefined();
    const rotated = await fixture.personal.rotate(
      browser.userId,
      created.summary.id,
    );
    expect(rotated.summary.expiresAt).toBe(created.summary.expiresAt);
    expect(rotated.token).not.toBe(created.token);
    await expect(fixture.personal.verify(created.token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(fixture.personal.verify(rotated.token)).resolves.toBeDefined();
    await fixture.personal.revoke(browser.userId, rotated.summary.id);
    await expect(fixture.personal.verify(rotated.token)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (await fixture.personal.list(browser.userId)).every(
        (summary) => summary.status === "revoked",
      ),
    ).toBe(true);
    await expect(
      fixture.personal.rotate(browser.userId, rotated.summary.id),
    ).rejects.toThrow(McpAuthorizationError);
    await expect(
      fixture.personal.rotate(browser.userId, "missing"),
    ).rejects.toThrow(McpAuthorizationError);
    expect(await fixture.personal.list("someone-else")).toEqual([]);
  });

  it("expires exactly at the deadline and supports unlimited tokens", async () => {
    const expiring = await fixture.personal.create(
      browser.userId,
      "temporary",
      Date.now() + 1,
    );
    const unlimited = await fixture.personal.create(
      browser.userId,
      "unlimited",
      null,
    );
    vi.setSystemTime(Date.now() + 1);
    await expect(fixture.personal.verify(expiring.token)).rejects.toThrow(
      McpAuthorizationError,
    );
    expect(
      (await fixture.personal.list(browser.userId))
        .map((summary) => summary.status)
        .sort(),
    ).toEqual(["active", "expired"]);
    await expect(
      fixture.personal.rotate(browser.userId, expiring.summary.id),
    ).rejects.toThrow(McpAuthorizationError);
    await expect(
      fixture.personal.verify(unlimited.token),
    ).resolves.toBeDefined();
    const replacement = await fixture.personal.rotate(
      browser.userId,
      unlimited.summary.id,
    );
    expect(replacement.summary.expiresAt).toBeNull();
  });

  it.each([
    [null, null],
    ["", null],
    ["x".repeat(101), null],
    ["test", "tomorrow"],
    ["test", 1.1],
    ["test", 0],
    ["test", undefined],
  ])("rejects invalid creation (%s, %s)", async (name, expiry) => {
    await expect(
      fixture.personal.create(browser.userId, name, expiry),
    ).rejects.toThrow(McpAuthorizationError);
  });

  it("uses personal admin eligibility in role mode and reloads rights at the next call", async () => {
    fixture.administration.getContext.mockResolvedValue(
      createAccess({ isAdmin: true, mode: "role", role: null }),
    );
    const created = await fixture.personal.create(
      browser.userId,
      "admin",
      null,
    );
    expect(await fixture.personal.verify(created.token)).toEqual({
      userId: browser.userId,
      isAdmin: true,
      permissions: Object.values(CAPABILITY),
    });
    fixture.administration.getContext.mockResolvedValue(
      createAccess({
        isAdmin: false,
        role: {
          id: "role",
          name: "reader",
          rank: 1,
          departmentBound: false,
          permissions: [CAPABILITY.WRITE],
        },
      }),
    );
    expect(await fixture.personal.verify(created.token)).toMatchObject({
      isAdmin: false,
      permissions: [CAPABILITY.WRITE],
    });
    fixture.administration.getContext.mockResolvedValue(
      createAccess({ isAdmin: false, role: null }),
    );
    expect(await fixture.personal.verify(created.token)).toMatchObject({
      isAdmin: false,
      permissions: [],
    });
    await expect(
      fixture.api.handle(created.token, { operation: "verify" }),
    ).resolves.toMatchObject({ tools: ["projects.names.list"] });
    await expect(
      fixture.api.handle(created.token, {
        operation: "projects.create",
        actor: { isAdmin: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
    fixture.users.getById.mockRejectedValue(new Error("database unavailable"));
    await expect(fixture.api.verify(created.token)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("fails closed for missing, deactivated or mandatory-password identities", async () => {
    for (const user of [
      null,
      createUser({ isActive: false }),
      createUser({ mustChangePassword: true }),
    ]) {
      fixture.users.getById.mockResolvedValue(user);
      await expect(
        fixture.identities.verify(browser.userId),
      ).rejects.toMatchObject({ status: 401 });
    }
    fixture.users.getById.mockResolvedValue(createUser());
    fixture.administration.getContext.mockResolvedValue(
      createAccess({ isActive: false }),
    );
    await expect(
      fixture.identities.verify(browser.userId),
    ).rejects.toMatchObject({ status: 401 });
    await expect(fixture.api.verify("unknown")).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("OAuth consent, PKCE and delegation", () => {
  it("binds one short-lived code to client, callback, resource and S256 verifier", async () => {
    const code = await issueCode(fixture);
    expect(code.view).toMatchObject({
      clientName: "Test client",
      resource: testOAuthConfiguration.resource,
    });
    expect(code.location.searchParams.get("iss")).toBe(
      testOAuthConfiguration.issuer,
    );
    expect(code.location.searchParams.get("state")).toBe("client-state");
    for (const [key, replacement] of [
      ["code", "unknown"],
      ["client_id", "another"],
      ["redirect_uri", "https://evil.invalid/"],
      ["resource", "https://evil.invalid/mcp"],
      ["code_verifier", "wrong"],
      ["code_verifier", "b".repeat(43)],
    ]) {
      const parameters = new URLSearchParams(code.exchange);
      parameters.set(key, replacement);
      await expect(fixture.tokens.exchange(parameters)).rejects.toMatchObject({
        code: "invalid_grant",
      });
    }
    const missingVerifier = new URLSearchParams(code.exchange);
    missingVerifier.delete("code_verifier");
    await expect(
      fixture.tokens.exchange(missingVerifier),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    const tokens = await fixture.tokens.exchange(code.exchange);
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      expires_in: 600,
      scope: "mcp:connect",
      refresh_token: expect.any(String),
    });
    await expect(fixture.tokens.exchange(code.exchange)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    const delegated = await fixture.tokens.delegate(
      tokens.access_token,
      testOAuthConfiguration.resource,
    );
    expect(delegated.delegationToken).not.toBe(tokens.access_token);
    expect(delegated.audience).toBe(testOAuthConfiguration.apiAudience);
    expect(delegated.expiresAt).toBe(Date.now() + 60_000);
    await expect(fixture.api.verify(tokens.access_token)).rejects.toMatchObject(
      { status: 401 },
    );
    await expect(
      fixture.api.verify(delegated.delegationToken),
    ).resolves.toMatchObject({ userId: browser.userId });
    await expect(
      fixture.tokens.delegate(tokens.access_token, "https://evil.invalid/mcp"),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      fixture.tokens.delegate(
        delegated.delegationToken,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toMatchObject({ status: 401 });
    vi.setSystemTime(Date.now() + 60_000);
    await expect(
      fixture.api.verify(delegated.delegationToken),
    ).rejects.toMatchObject({ status: 401 });
    vi.setSystemTime(Date.now() + 539_000);
    const last = await fixture.tokens.delegate(
      tokens.access_token,
      testOAuthConfiguration.resource,
    );
    expect(last.expiresAt).toBe(Date.now() + 1000);
    vi.setSystemTime(Date.now() + 1000);
    await expect(
      fixture.tokens.delegate(
        tokens.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects late/repeated consent, binds CSRF to the user/session and supports explicit denial", async () => {
    const client = await fixture.clients.register(clientMetadata);
    const id = await fixture.consent.begin(authorizationParameters(client));
    const view = await fixture.consent.view(id, browser);
    await expect(
      fixture.consent.view(id, { ...browser, userId: "other" }),
    ).rejects.toMatchObject({ status: 403 });
    for (const wrongBrowser of [
      { ...browser, userId: "other" },
      { ...browser, session: "other-session" },
    ]) {
      await expect(
        fixture.consent.decide(
          { id, csrf: view.csrf, approved: true },
          wrongBrowser,
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      fixture.consent.decide({ id, csrf: "wrong", approved: true }, browser),
    ).rejects.toMatchObject({ status: 403 });
    const destination = new URL(
      await fixture.consent.decide(
        { id, csrf: view.csrf, approved: false },
        browser,
      ),
    );
    expect(destination.searchParams.get("error")).toBe("access_denied");
    expect(destination.searchParams.has("code")).toBe(false);
    await expect(
      fixture.consent.decide({ id, csrf: view.csrf, approved: true }, browser),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(fixture.consent.view("unknown", browser)).rejects.toThrow(
      McpAuthorizationError,
    );
    const late = await fixture.consent.begin(authorizationParameters(client));
    vi.setSystemTime(Date.now() + 900_000);
    await expect(fixture.consent.view(late, browser)).rejects.toThrow(
      McpAuthorizationError,
    );
  });

  it("expires authorization codes at 60 seconds and never issues refresh tokens to unsupported clients", async () => {
    const code = await issueCode(fixture, {
      ...clientMetadata,
      grant_types: ["authorization_code"],
    });
    vi.setSystemTime(Date.now() + 60_000);
    await expect(fixture.tokens.exchange(code.exchange)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    const fresh = await issueCode(fixture, {
      ...clientMetadata,
      grant_types: ["authorization_code"],
    });
    const tokens = await fixture.tokens.exchange(fresh.exchange);
    expect(tokens.refresh_token).toBeUndefined();
  });

  it("rotates refresh tokens and permanently revokes the grant on concurrent reuse", async () => {
    const code = await issueCode(fixture);
    const tokens = await fixture.tokens.exchange(code.exchange);
    const refresh = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: code.client.client_id,
      resource: testOAuthConfiguration.resource,
      refresh_token: tokens.refresh_token ?? "",
    });
    const results = await Promise.allSettled([
      fixture.tokens.exchange(refresh),
      fixture.tokens.exchange(refresh),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      fixture.tokens.delegate(
        tokens.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toMatchObject({ status: 401 });
    const first = results.find((result) => result.status === "fulfilled");
    if (!first || first.status !== "fulfilled")
      throw new Error("Expected a successful first exchange");
    expect(first.value.refresh_token).not.toBe(tokens.refresh_token);
    await expect(
      fixture.tokens.delegate(
        first.value.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect((await fixture.grants.get(browser.userId)).grants[0]?.status).toBe(
      "revoked",
    );
  });

  it("refreshes past access expiry, requires current rights and immediately honors revocation", async () => {
    const code = await issueCode(fixture);
    const tokens = await fixture.tokens.exchange(code.exchange);
    vi.setSystemTime(Date.now() + 600_000);
    const refreshed = await fixture.tokens.exchange(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: code.client.client_id,
        resource: testOAuthConfiguration.resource,
        refresh_token: tokens.refresh_token ?? "",
      }),
    );
    fixture.administration.getContext.mockResolvedValue(
      createAccess({ isAdmin: true, mode: "role", role: null }),
    );
    const delegated = await fixture.tokens.delegate(
      refreshed.access_token,
      testOAuthConfiguration.resource,
    );
    expect(delegated.identity.isAdmin).toBe(true);
    fixture.administration.getContext.mockResolvedValue(
      createAccess({ isAdmin: false, role: null }),
    );
    expect(
      await fixture.tokens.verifyDelegation(delegated.delegationToken),
    ).toMatchObject({ isAdmin: false, permissions: [] });
    const grantId = (await fixture.grants.get(browser.userId)).grants[0]?.id;
    if (!grantId) throw new Error("Missing grant");
    await expect(fixture.grants.revoke("other", grantId)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      fixture.grants.revoke(browser.userId, "missing"),
    ).rejects.toMatchObject({ status: 403 });
    await fixture.grants.revoke(browser.userId, grantId);
    await expect(
      fixture.tokens.verifyDelegation(delegated.delegationToken),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("applies shorter/longer/unlimited settings to active grants and never resurrects ended grants", async () => {
    expect((await fixture.grants.get(browser.userId)).durationSeconds).toBe(
      86_400,
    );
    await fixture.grants.setDuration(browser.userId, 100);
    const code = await issueCode(fixture);
    const tokens = await fixture.tokens.exchange(code.exchange);
    vi.setSystemTime(Date.now() + 50_000);
    await fixture.grants.setDuration(browser.userId, 200);
    expect(
      (await fixture.grants.get(browser.userId)).grants[0]?.expiresAt,
    ).toBe(Date.now() + 150_000);
    await fixture.grants.setDuration(browser.userId, null);
    expect(
      (await fixture.grants.get(browser.userId)).grants[0]?.expiresAt,
    ).toBeNull();
    await fixture.grants.setDuration(browser.userId, 40);
    await expect(
      fixture.tokens.delegate(
        tokens.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await fixture.grants.setDuration(browser.userId, null);
    expect((await fixture.grants.get(browser.userId)).grants[0]?.status).toBe(
      "expired",
    );
    await fixture.grants.setDuration(browser.userId, 10);
    const another = await issueCode(fixture);
    const anotherTokens = await fixture.tokens.exchange(another.exchange);
    vi.setSystemTime(Date.now() + 10_000);
    // No intervening verify: lengthening still cannot revive a grant expired under the previous setting.
    await fixture.grants.setDuration(browser.userId, 1000);
    await expect(
      fixture.tokens.delegate(
        anotherTokens.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toThrow(McpAuthorizationError);
    await fixture.grants.setDuration(browser.userId, null);
    const unlimited = await issueCode(fixture);
    expect(await fixture.tokens.exchange(unlimited.exchange)).toHaveProperty(
      "access_token",
    );
  });

  it("expires consent during token validation and keeps terminal expiry after extension", async () => {
    await fixture.grants.setDuration(browser.userId, 1);
    const code = await issueCode(fixture);
    const tokens = await fixture.tokens.exchange(code.exchange);
    vi.setSystemTime(Date.now() + 1000);
    await expect(
      fixture.tokens.delegate(
        tokens.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toThrow(McpAuthorizationError);
    await fixture.grants.setDuration(browser.userId, null);
    expect((await fixture.grants.get(browser.userId)).grants[0]?.status).toBe(
      "expired",
    );
  });

  it.each([undefined, 0, -1, 1.5, "forever", 315_576_001])(
    "rejects invalid grant duration %s",
    async (duration) => {
      await expect(
        fixture.grants.setDuration(browser.userId, duration),
      ).rejects.toThrow(McpAuthorizationError);
    },
  );

  it("rejects unsupported grants, duplicate parameters and client secrets", async () => {
    for (const parameters of [
      new URLSearchParams(),
      new URLSearchParams("grant_type=password"),
      new URLSearchParams(
        "grant_type=refresh_token&grant_type=authorization_code",
      ),
      new URLSearchParams("grant_type=authorization_code&client_secret=secret"),
    ]) {
      await expect(fixture.tokens.exchange(parameters)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });
});

describe("OAuth client metadata and configuration", () => {
  it("rejects missing code/refresh credentials without manufacturing an identity", async () => {
    for (const grantType of ["authorization_code", "refresh_token"]) {
      await expect(
        fixture.tokens.exchange(new URLSearchParams({ grant_type: grantType })),
      ).rejects.toMatchObject({ code: "invalid_grant" });
    }
  });

  it("rejects orphaned credentials, missing registrations, resource changes and unavailable verification", async () => {
    const code = await issueCode(fixture);
    await fixture.database.execute("DELETE FROM mcp_oauth_clients;");
    await expect(fixture.tokens.exchange(code.exchange)).rejects.toMatchObject({
      code: "invalid_client",
    });
    await fixture.repository.clients().save(code.client);
    const tokens = await fixture.tokens.exchange(code.exchange);
    const delegated = await fixture.tokens.delegate(
      tokens.access_token,
      testOAuthConfiguration.resource,
    );
    await fixture.database.execute(
      "UPDATE mcp_oauth_grants SET resource = 'https://wrong.invalid/mcp';",
    );
    await expect(
      fixture.tokens.verifyDelegation(delegated.delegationToken),
    ).rejects.toMatchObject({ status: 401 });
    await fixture.database.execute("DELETE FROM mcp_oauth_grants;");
    await expect(
      fixture.tokens.delegate(
        tokens.access_token,
        testOAuthConfiguration.resource,
      ),
    ).rejects.toMatchObject({ status: 401 });
    const refresh = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: code.client.client_id,
      resource: testOAuthConfiguration.resource,
      refresh_token: tokens.refresh_token ?? "",
    });
    await expect(fixture.tokens.exchange(refresh)).rejects.toMatchObject({
      code: "invalid_grant",
    });
    vi.spyOn(fixture.tokens, "verifyDelegation").mockRejectedValue(
      new Error("verification unavailable"),
    );
    await expect(fixture.api.verify("unknown")).rejects.toThrow(
      "verification unavailable",
    );
  });

  it("keeps nested mutations atomic and rolls back revoked personal tokens on failure", async () => {
    const personal = await fixture.personal.create(
      browser.userId,
      "transaction",
      null,
    );
    await expect(
      fixture.personalRepository.transaction(async (repository) =>
        repository.transaction(async (nested) => {
          await nested.revoke(browser.userId, personal.summary.id, Date.now());
          throw new Error("cancel rotation");
        }),
      ),
    ).rejects.toThrow("cancel rotation");
    await expect(
      fixture.personal.verify(personal.token),
    ).resolves.toBeDefined();
    await expect(
      fixture.repository.transaction(async (repository) =>
        repository.transaction(async (nested) => {
          await nested.grants().setDuration(browser.userId, 10, Date.now());
          throw new Error("cancel setting");
        }),
      ),
    ).rejects.toThrow("cancel setting");
    expect((await fixture.grants.get(browser.userId)).durationSeconds).toBe(
      86_400,
    );
  });

  it("omits a missing summary without manufacturing a grant", async () => {
    await issueCode(fixture);
    vi.spyOn(OAuthGrantRepository.prototype, "find").mockResolvedValue(null);
    expect((await fixture.grants.get(browser.userId)).grants).toEqual([]);
  });
  it("prefers fresh matching CIMD documents while keeping DCR a separate step", async () => {
    const id = "https://client.invalid/metadata.json";
    fixture.metadata.mockResolvedValue({ ...clientMetadata, client_id: id });
    expect(await fixture.clients.resolve(id)).toMatchObject({ client_id: id });
    expect(fixture.metadata).toHaveBeenCalledWith(id);
    const client = await fixture.clients.register(clientMetadata);
    expect(await fixture.clients.resolve(client.client_id)).toEqual(client);
    await expect(fixture.clients.resolve("unknown")).rejects.toMatchObject({
      code: "invalid_client",
    });
    for (const metadata of [
      null,
      4,
      {},
      { ...clientMetadata, client_id: "different" },
      { client_id: id },
    ]) {
      fixture.metadata.mockResolvedValue(metadata);
      await expect(fixture.clients.resolve(id)).rejects.toMatchObject({
        code: "invalid_client",
      });
    }
    fixture.metadata.mockRejectedValue(
      new Error("secret in provider diagnostic"),
    );
    await expect(fixture.clients.resolve(id)).rejects.toThrow(
      "The authorization request was rejected.",
    );
    expect(new OAuthClientService(fixture.repository)).toBeDefined();
  });

  it("rejects unauthorized callbacks, missing clients and invalid request parameters", async () => {
    const client = await fixture.clients.register(clientMetadata);
    const valid = authorizationParameters(client);
    const badRedirect = new URLSearchParams(valid);
    badRedirect.set("redirect_uri", "https://evil.invalid/callback");
    await expect(fixture.consent.begin(badRedirect)).rejects.toThrow(
      McpAuthorizationError,
    );
    for (const [key, replacement] of [
      ["response_type", "token"],
      ["code_challenge_method", "plain"],
      ["scope", "admin"],
      ["resource", "wrong"],
      ["client_id", ""],
      ["client_id", "x".repeat(2049)],
      ["redirect_uri", "x".repeat(2049)],
      ["state", "x".repeat(513)],
      ["code_challenge", "wrong"],
    ]) {
      const parameters = new URLSearchParams(valid);
      parameters.set(key, replacement);
      expect(() =>
        parseAuthorizationRequest(parameters, testOAuthConfiguration),
      ).toThrow(McpAuthorizationError);
    }
    const duplicate = new URLSearchParams(valid);
    duplicate.append("client_id", client.client_id);
    expect(() =>
      parseAuthorizationRequest(duplicate, testOAuthConfiguration),
    ).toThrow(McpAuthorizationError);
    expect(() =>
      parseAuthorizationRequest(new URLSearchParams(), testOAuthConfiguration),
    ).toThrow(McpAuthorizationError);
    const minimal = new URLSearchParams(valid);
    minimal.delete("scope");
    minimal.delete("state");
    expect(
      parseAuthorizationRequest(minimal, testOAuthConfiguration).state,
    ).toBe("");
    const id = await fixture.consent.begin(valid);
    await fixture.database.execute("DELETE FROM mcp_oauth_clients;");
    await expect(fixture.consent.view(id, browser)).rejects.toMatchObject({
      code: "invalid_client",
    });
  });

  it("defaults optional public metadata fields and accepts only safe exact callback URIs", () => {
    expect(
      parseOAuthClient(
        {
          client_name: "Public",
          redirect_uris: ["https://client.invalid/callback"],
        },
        "id",
      ),
    ).toMatchObject({
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    for (const uri of [
      undefined,
      1,
      "invalid",
      "x".repeat(2049),
      "http://evil.invalid/callback",
      "https://user:password@client.invalid/",
      "https://client.invalid/#fragment",
      "ftp://client.invalid/",
    ])
      expect(isRedirectUri(uri)).toBe(false);
    for (const uri of [
      "https://client.invalid/callback",
      "http://127.0.0.1:5432/callback",
      "http://[::1]/callback",
      "http://localhost/callback",
    ])
      expect(isRedirectUri(uri)).toBe(true);
    for (const input of [
      null,
      1,
      {},
      { ...clientMetadata, client_name: 2 },
      { ...clientMetadata, client_name: " " },
      { ...clientMetadata, client_name: "x".repeat(101) },
      { ...clientMetadata, redirect_uris: "bad" },
      { ...clientMetadata, redirect_uris: [] },
      {
        ...clientMetadata,
        redirect_uris: Array(11).fill("https://client.invalid/"),
      },
      { ...clientMetadata, redirect_uris: ["bad"] },
      { ...clientMetadata, grant_types: "bad" },
      { ...clientMetadata, grant_types: [] },
      { ...clientMetadata, grant_types: ["authorization_code", "password"] },
      { ...clientMetadata, response_types: "bad" },
      { ...clientMetadata, response_types: [] },
      { ...clientMetadata, response_types: ["token"] },
      { ...clientMetadata, token_endpoint_auth_method: "client_secret_basic" },
    ]) {
      expect(() => parseOAuthClient(input, "id")).toThrow(
        "Invalid client metadata.",
      );
    }
    expect(
      parseOAuthClient(
        {
          ...clientMetadata,
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        "id",
      ),
    ).toBeDefined();
  });

  it("publishes only explicit issuer/resource metadata and fails closed on malformed configuration", () => {
    expect(
      readOAuthConfiguration({
        PAGES_OAUTH_ISSUER: testOAuthConfiguration.issuer,
        PAGES_MCP_RESOURCE: testOAuthConfiguration.resource,
      }),
    ).toEqual(testOAuthConfiguration);
    expect(authorizationMetadata(testOAuthConfiguration)).toMatchObject({
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
    });
    for (const settings of [
      {},
      { PAGES_OAUTH_ISSUER: "bad" },
      {
        PAGES_OAUTH_ISSUER: testOAuthConfiguration.issuer,
        PAGES_MCP_RESOURCE: "bad",
      },
      {
        PAGES_OAUTH_ISSUER: "https://pages.invalid/path",
        PAGES_MCP_RESOURCE: testOAuthConfiguration.resource,
      },
      {
        PAGES_OAUTH_ISSUER: "https://pages.invalid/?query=1",
        PAGES_MCP_RESOURCE: testOAuthConfiguration.resource,
      },
      {
        PAGES_OAUTH_ISSUER: testOAuthConfiguration.issuer,
        PAGES_MCP_RESOURCE: "https://mcp.invalid/mcp?query=1",
      },
      {
        PAGES_OAUTH_ISSUER: testOAuthConfiguration.issuer,
        PAGES_MCP_RESOURCE: "https://mcp.invalid/wrong",
      },
    ])
      expect(() => readOAuthConfiguration(settings)).toThrow(
        McpAuthorizationError,
      );
    expect(new McpAuthorizationError("failure").status).toBe(400);
  });
});
