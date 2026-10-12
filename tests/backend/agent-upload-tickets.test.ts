import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";
import { AgentUploadAuthorityService } from "@/backend/service/agents/AgentUploadAuthorityService";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";
import { useMigratedDatabase } from "../helpers/test-database";
import {
  agentWriteFixture,
  bytes,
  createInput,
  PNG,
  WRITE_IDENTITY,
} from "../helpers/agent-writes";
import {
  authorizationFixture,
  issueCode,
  testOAuthConfiguration,
} from "../helpers/mcp-authorization";

import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";
import type { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("one-use upload ticket authority", () => {
  const getDatabase = useMigratedDatabase();
  async function fixture() {
    const run = await agentWriteFixture(getDatabase());
    directories.push(run.filesDirectory);
    return run;
  }

  it("offers writes only to authorized identities, binds sanitized metadata and consumes once before streaming", async () => {
    const run = await fixture();
    expect(
      await run.api.handle(run.token, { operation: "verify" }),
    ).toMatchObject({
      tools: expect.arrayContaining([
        "assets.upload.prepare",
        "wiki.page.create",
      ]),
    });
    const prepared = await run.api.handle(run.token, {
      operation: "assets.upload.prepare",
      parameters: { fileName: "../photo.png" },
    });
    if (!("result" in prepared) || !("ticket" in prepared.result))
      throw new Error("Expected upload ticket.");
    expect(prepared.result).toMatchObject({
      ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      header: "X-Pages-Upload-Ticket",
      uploadPath: "/api/v1/agent-assets",
      mediaLimitBytes: WIKI_SETTING_DEFAULTS.mediaLimitBytes,
    });
    const authority = await run.tickets.consume(prepared.result.ticket);
    expect(authority.fileName).toBe("photo.png");
    expect(await authority.revalidate()).toMatchObject({ userId: "owner" });
    await expect(
      run.tickets.consume(prepared.result.ticket),
    ).rejects.toMatchObject({ status: 401 });
    const result = await run.router.handle(WRITE_IDENTITY, {
      operation: "wiki.page.create",
      parameters: createInput(),
    });
    expect(result).toMatchObject({
      apiVersion: "1",
      result: { pageId: expect.any(String) },
    });
  });

  it("expires and prunes pending capabilities, rejects missing/unknown authority and refuses changed owners", async () => {
    const verify = vi.fn().mockResolvedValue(WRITE_IDENTITY);
    const tickets = new AgentUploadTicketService(verify);
    const issued = tickets.issue("synthetic", "owner", "image.png");
    tickets.issue("synthetic", "owner", "pending.png");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(issued.expiresAt);
    await expect(tickets.consume(issued.ticket)).rejects.toMatchObject({
      status: 401,
    });
    const expired = tickets.issue("synthetic", "owner", "file");
    vi.setSystemTime(expired.expiresAt);
    const current = tickets.issue("synthetic", "owner", "file");
    await expect(tickets.consume(expired.ticket)).rejects.toMatchObject({
      status: 401,
    });
    await expect(tickets.consume("missing")).rejects.toMatchObject({
      status: 401,
    });
    verify.mockResolvedValue({ ...WRITE_IDENTITY, userId: "other" });
    await expect(tickets.consume(current.ticket)).rejects.toMatchObject({
      status: 401,
    });
    expect(verify).toHaveBeenCalledWith(
      hashAgentCredential("synthetic"),
      expect.any(Number),
    );
  });

  it("rejects revoked personal credentials and rights lost while bytes are arriving without persisting an asset", async () => {
    const run = await fixture();
    const issued = run.tickets.issue(run.token, run.owner.id, "image.png");
    await run.personal.revoke(run.owner.id, run.tokenId);
    await expect(run.tickets.consume(issued.ticket)).rejects.toMatchObject({
      status: 401,
    });
    const credential = await run.personal.create("owner", "another", null);
    const consumed = await run.tickets.consume(
      run.tickets.issue(credential.token, "owner", "image.png").ticket,
    );
    async function* revokedStream() {
      yield PNG;
      await run.personal.revoke("owner", credential.summary.id);
    }
    await expect(
      run.assets.upload(
        {
          fileName: consumed.fileName,
          contentLength: null,
          body: revokedStream(),
        },
        consumed.revalidate,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_assets;"),
    ).toEqual([[0]]);
    const lostWrite = vi
      .fn()
      .mockResolvedValueOnce(WRITE_IDENTITY)
      .mockResolvedValueOnce({
        ...WRITE_IDENTITY,
        isAdmin: false,
        permissions: [],
      });
    await expect(
      run.assets.upload(
        { fileName: "image.png", contentLength: null, body: bytes(PNG) },
        lostWrite,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ordinary: AgentIdentity = {
      ...WRITE_IDENTITY,
      isAdmin: false,
      permissions: ["write"],
    };
    expect(
      await run.assets.upload(
        { fileName: "image.png", contentLength: null, body: bytes(PNG) },
        async () => ordinary,
      ),
    ).toMatchObject({ assetId: expect.any(String) });
  });

  it("checks persisted write rights after streaming and on the next call while retaining the offered catalog", async () => {
    const run = await fixture();
    const writer = await run.addUser("writer", { capabilities: ["write"] });
    const credential = await run.personal.create(writer.id, "writer", null);
    expect(
      await run.api.handle(credential.token, { operation: "verify" }),
    ).toMatchObject({
      tools: expect.arrayContaining([
        "assets.upload.prepare",
        "wiki.page.create",
      ]),
    });
    const upload = await run.tickets.consume(
      run.tickets.issue(credential.token, writer.id, "image.png").ticket,
    );
    const authorization = new AuthorizationRepository(run.database);
    const account = (await authorization.snapshot()).accounts.find(
      (entry) => entry.userId === writer.id,
    );
    if (!account?.role) throw new Error("Expected writer role.");
    const role = account.role;
    async function* revokedRights() {
      yield PNG;
      await authorization.saveRole({ ...role, permissions: [] });
    }
    await expect(
      run.assets.upload(
        {
          fileName: upload.fileName,
          contentLength: null,
          body: revokedRights(),
        },
        upload.revalidate,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const verification = await run.api.handle(credential.token, {
      operation: "verify",
    });
    if (!("tools" in verification)) throw new Error("Expected verification.");
    expect(verification.tools).toContain("assets.upload.prepare");
    expect(verification.tools).toContain("wiki.page.create");
    await expect(
      run.api.handle(credential.token, {
        operation: "assets.upload.prepare",
        parameters: { fileName: "next.png" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_assets;"),
    ).toEqual([[0]]);
  });

  it("validates metadata and persisted actors before any operation row exists", async () => {
    const run = await fixture();
    for (const input of [
      null,
      [],
      "bad",
      undefined,
      {},
      { fileName: 1 },
      { fileName: "image.png", bytes: "forbidden" },
    ])
      await expect(
        run.writes.prepare(WRITE_IDENTITY, run.token, input),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      run.writes.prepare(
        { ...WRITE_IDENTITY, isAdmin: false, permissions: [] },
        run.token,
        { fileName: "image.png" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await run.writes.prepare(
        { ...WRITE_IDENTITY, isAdmin: false, permissions: ["write"] },
        run.token,
        { fileName: "image.png" },
      ),
    ).toMatchObject({ result: { ticket: expect.any(String) } });
    for (const input of [null, [], "bad"])
      await expect(
        run.writes.create(WRITE_IDENTITY, input),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      run.writes.create(
        { ...WRITE_IDENTITY, userId: "missing" },
        createInput(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await run.database.execute(
      "UPDATE users SET must_change_password = 1 WHERE id = 'owner';",
    );
    await expect(
      run.writes.create(WRITE_IDENTITY, createInput()),
    ).rejects.toMatchObject({ status: 401 });
    const users = new UserRepository(run.database);
    const noWrites = new AgentOperationRouter({
      users: { getById: (id) => users.findById(id) },
      projects: new ProjectRepository(run.database),
      wiki: run.repository,
    });
    await expect(
      noWrites.prepareUpload(WRITE_IDENTITY, run.token, {}),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      noWrites.handle(WRITE_IDENTITY, { operation: "wiki.page.create" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("redacts authentication failures but propagates infrastructure failures to the route boundary", async () => {
    const personal = { verifyHash: vi.fn() };
    const oauth = { verifyDelegationHash: vi.fn() };
    const authority = new AgentUploadAuthorityService(
      personal as unknown as PersonalAgentTokenService,
      oauth as unknown as OAuthTokenService,
    );
    personal.verifyHash.mockRejectedValue(
      new McpAuthorizationError("invalid_token", 401),
    );
    oauth.verifyDelegationHash.mockResolvedValue(WRITE_IDENTITY);
    expect(await authority.verify("hash", 1)).toEqual(WRITE_IDENTITY);
    oauth.verifyDelegationHash.mockRejectedValue(
      new McpAuthorizationError("invalid_request"),
    );
    await expect(authority.verify("hash", 1)).rejects.toMatchObject({
      code: "invalid_token",
      status: 401,
    });
    oauth.verifyDelegationHash.mockRejectedValue(new Error("unavailable"));
    await expect(authority.verify("hash", 1)).rejects.toThrow("unavailable");
    for (const error of [
      new Error("offline"),
      new McpAuthorizationError("unavailable", 503),
    ]) {
      personal.verifyHash.mockRejectedValue(error);
      await expect(authority.verify("hash", 1)).rejects.toThrow(error);
    }
  });

  it("keeps a minted OAuth ticket usable after technical delegation expiry while rechecking current consent and rights", async () => {
    const run = await authorizationFixture();
    try {
      const code = await issueCode(run);
      const tokens = await run.tokens.exchange(code.exchange);
      const delegated = await run.tokens.delegate(
        tokens.access_token,
        testOAuthConfiguration.resource,
      );
      const authority = new AgentUploadAuthorityService(
        run.personal,
        run.tokens,
      );
      const tickets = new AgentUploadTicketService((hash, issuedAt) =>
        authority.verify(hash, issuedAt),
      );
      const issued = tickets.issue(
        delegated.delegationToken,
        delegated.identity.userId,
        "image.png",
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(delegated.expiresAt + 1);
      await expect(
        run.tokens.verifyDelegation(delegated.delegationToken),
      ).rejects.toMatchObject({ status: 401 });
      const upload = await tickets.consume(issued.ticket);
      expect(await upload.revalidate()).toMatchObject({
        userId: delegated.identity.userId,
      });
      const origin = await run.repository
        .credentials()
        .find(hashAgentCredential(delegated.delegationToken), "delegation");
      if (!origin) throw new Error("Expected delegation origin.");
      await run.grants.revoke(delegated.identity.userId, origin.grantId);
      await expect(upload.revalidate()).rejects.toMatchObject({ status: 401 });
      await expect(tickets.consume(tokens.access_token)).rejects.toMatchObject({
        status: 401,
      });
    } finally {
      await run.database.close();
    }
  });
});
