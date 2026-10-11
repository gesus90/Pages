import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ServerCache } from "@/backend/cache/ServerCache";
import { authorizationFixture } from "../helpers/mcp-authorization";
import { importRequest } from "../helpers/wiki-import";
import {
  structuredManifest,
  useStructuredImportHarness,
} from "../helpers/structured-import";
import { confirmedUpdate } from "../helpers/wiki-import-update";
import {
  confirmedImport,
  useWikiImportApplyHarness,
} from "../helpers/wiki-import-apply";

describe("MCP service wiring", () => {
  it("keeps OAuth configuration lazy while personal-token verification remains available", async () => {
    const fixture = await authorizationFixture();
    try {
      vi.stubEnv("PAGES_OAUTH_ISSUER", "");
      vi.stubEnv("PAGES_MCP_RESOURCE", "");
      const services = createMcpServices(
        fixture.database,
        fixture.users,
        fixture.administration,
        {
          directory: tmpdir(),
          wikiService: {
            getSettings: async () => WIKI_SETTING_DEFAULTS,
            openAttachment: vi.fn(),
          },
        },
      );
      const created = await services.personalAgentTokenService.create(
        "user-1",
        "local",
        null,
      );
      await expect(
        services.pagesAgentApiService.handle(created.token, {
          operation: "verify",
        }),
      ).resolves.toMatchObject({
        tools: expect.arrayContaining(["projects.names.list", "wiki.search"]),
      });
      const upload = await services.pagesAgentApiService.handle(created.token, {
        operation: "assets.upload.prepare",
        parameters: { fileName: "image.png" },
      });
      if (!("result" in upload) || !("ticket" in upload.result))
        throw new Error("Expected upload ticket.");
      await expect(
        services.agentUploadTicketService.consume(upload.result.ticket),
      ).resolves.toMatchObject({ fileName: "image.png" });
      await expect(
        services.oauthConsentService.begin(new URLSearchParams()),
      ).rejects.toMatchObject({ status: 503 });
      vi.stubEnv("PAGES_OAUTH_ISSUER", "https://pages.invalid");
      vi.stubEnv("PAGES_MCP_RESOURCE", "https://mcp.invalid/mcp");
      await expect(
        services.oauthConsentService.begin(new URLSearchParams()),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      await fixture.database.close();
    }
  });
});

describe("A9.8 application service wiring", () => {
  const setup = useWikiImportApplyHarness();

  it("routes a confirmed import through a real personal credential, transaction and policy and blocks revoked replay", async () => {
    const harness = await setup();
    const users = new UserRepository(harness.database);
    const authorization = new AuthorizationRepository(harness.database);
    const services = createMcpServices(
      harness.database,
      { getById: (id) => users.findById(id) },
      {
        getContext: async (id) => {
          const account = (await authorization.snapshot()).accounts.find(
            (entry) => entry.userId === id,
          );
          if (!account) throw new Error("Expected test account.");
          return account;
        },
      },
      { directory: harness.filesDirectory, wikiService: harness.service },
    );
    const credential = await services.personalAgentTokenService.create(
      "writer",
      "import-test",
      null,
    );
    const input = {
      operation: "wiki.import.apply",
      parameters: await confirmedImport(harness),
    };
    const first = await services.pagesAgentApiService.handle(
      credential.token,
      input,
    );
    expect(first).toMatchObject({
      apiVersion: "1",
      result: {
        status: "complete",
        counts: { created: 1 },
        items: [{ sourceKey: "new.md", action: "created" }],
      },
    });
    expect(
      await services.pagesAgentApiService.handle(credential.token, input),
    ).toEqual(first);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[1]]);
    await services.personalAgentTokenService.revoke(
      "writer",
      credential.summary.id,
    );
    await expect(
      services.pagesAgentApiService.handle(credential.token, input),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[1]]);
  });
});

describe("A9.9 application service wiring", () => {
  const setup = useWikiImportApplyHarness();

  it("updates through the authenticated API and rejects a revoked retry", async () => {
    const harness = await setup();
    const users = new UserRepository(harness.database);
    const authorization = new AuthorizationRepository(harness.database);
    const services = createMcpServices(
      harness.database,
      { getById: (id) => users.findById(id) },
      {
        getContext: async (id) => {
          const account = (await authorization.snapshot()).accounts.find(
            (entry) => entry.userId === id,
          );
          if (!account) throw new Error("Expected test account.");
          return account;
        },
      },
      {
        directory: harness.filesDirectory,
        wikiService: harness.service,
        tickets: { cache: ServerCache.disabled(), publisher: null },
      },
    );
    const credential = await services.personalAgentTokenService.create(
      "writer",
      "update-test",
      null,
    );
    await services.pagesAgentApiService.handle(credential.token, {
      operation: "wiki.import.apply",
      parameters: await confirmedImport(harness),
    });
    const input = {
      operation: "wiki.import.update",
      parameters: await confirmedUpdate(
        harness,
        importRequest([{ sourceKey: "new.md", content: "Updated" }]),
      ),
    };
    const events = vi.fn();
    services.pagesEventPublisher.subscribe(events);
    const response = await services.pagesAgentApiService.handle(
      credential.token,
      input,
    );
    expect(response).toMatchObject({
      apiVersion: "1",
      result: {
        counts: { updated: 1 },
        items: [{ action: "updated", revision: 2 }],
      },
    });
    expect(
      await services.pagesAgentApiService.handle(credential.token, input),
    ).toEqual(response);
    expect(events).toHaveBeenCalledOnce();
    await services.personalAgentTokenService.revoke(
      "writer",
      credential.summary.id,
    );
    await expect(
      services.pagesAgentApiService.handle(credential.token, input),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await harness.database.query("SELECT content, revision FROM wiki_pages;"),
    ).toEqual([["Updated", 2]]);
  });
});

// The fixture owns every credential and persists only to an in-memory DuckDB.
describe("A9.12 authenticated application wiring", () => {
  const setup = useStructuredImportHarness();

  it("plans, applies and recovers the same durable run through a real personal token, then blocks revoked replay", async () => {
    const harness = await setup();
    const authorization = new AuthorizationRepository(harness.database);
    const services = createMcpServices(
      harness.database,
      { getById: (id) => harness.users.findById(id) },
      {
        getContext: async (id) => {
          const account = (await authorization.snapshot()).accounts.find(
            (entry) => entry.userId === id,
          );
          if (!account) throw new Error("Expected account.");
          return account;
        },
      },
      {
        directory: harness.filesDirectory,
        wikiService: harness.service,
        tickets: {
          cache: harness.cache,
          publisher: { publish: harness.publish },
        },
      },
    );
    const credential = await services.personalAgentTokenService.create(
      "owner",
      "structured-test",
      null,
    );
    const manifest = structuredManifest();
    const preview = await services.pagesAgentApiService.handle(
      credential.token,
      { operation: "import.structured.plan", parameters: { manifest } },
    );
    if (!("result" in preview) || !("fingerprint" in preview.result))
      throw new Error("Expected preview.");
    const request = {
      operation: "import.structured.apply",
      parameters: {
        manifest,
        operationId: "authenticated",
        fingerprint: preview.result.fingerprint,
      },
    };
    const first = await services.pagesAgentApiService.handle(
      credential.token,
      request,
    );
    expect(first).toMatchObject({
      result: {
        status: "complete",
        counts: { created: 7, skipped: 0, conflict: 0, failed: 0 },
      },
    });
    expect(
      await services.pagesAgentApiService.handle(credential.token, request),
    ).toEqual(first);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM work_items;"),
    ).toEqual([[2]]);
    expect(harness.publish).toHaveBeenCalledTimes(2);
    await services.personalAgentTokenService.revoke(
      "owner",
      credential.summary.id,
    );
    await expect(
      services.pagesAgentApiService.handle(credential.token, request),
    ).rejects.toMatchObject({ status: 401 });
  });
});
