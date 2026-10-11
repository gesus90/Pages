import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import {
  PAGES_AGENT_COMMENT_OPERATIONS,
  PAGES_AGENT_READ_OPERATIONS,
  PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
  PAGES_AGENT_TICKET_READ_OPERATIONS,
} from "@/definition/PagesAgentOperations";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";

import type { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import type { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";
import type { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";

const identity = { userId: "owner", isAdmin: false, permissions: [] };
const personal = { verify: vi.fn() };
const oauth = { verifyDelegation: vi.fn() };
const projects = { listNames: vi.fn() };
const operations = { handle: vi.fn() };
const service = new PagesAgentApiService(
  personal as unknown as PersonalAgentTokenService,
  oauth as unknown as OAuthTokenService,
  projects as unknown as AgentProjectService,
  operations as unknown as AgentOperationRouter,
);

beforeEach(() => {
  vi.resetAllMocks();
  personal.verify.mockResolvedValue(identity);
  operations.handle.mockRejectedValue(
    new AgentOperationError("INVALID_REQUEST"),
  );
  projects.listNames.mockResolvedValue(["Alpha", "Beta"]);
});

describe("agent API import revalidation", () => {
  it.each([
    "wiki.import.apply",
    "wiki.import.update",
    "import.structured.apply",
  ])("passes fresh credential verification to %s", async (operation) => {
    const response: PagesAgentWriteResponse = {
      apiVersion: "1",
      result: { pageId: "page", link: "/wiki/page", assets: [] },
    };
    let revalidate: (() => Promise<AgentIdentity>) | undefined;
    operations.handle.mockImplementation(
      async (_owner, _request, verify: () => Promise<AgentIdentity>) => {
        revalidate = verify;
        return response;
      },
    );
    const input = { operation, parameters: { operationId: "import" } };
    expect(await service.handle("token", input)).toBe(response);
    expect(operations.handle).toHaveBeenCalledExactlyOnceWith(
      identity,
      input,
      expect.any(Function),
    );
    if (!revalidate) throw new Error("Expected credential revalidation.");
    const current = { ...identity, permissions: ["write"] };
    personal.verify.mockResolvedValue(current);
    expect(await revalidate()).toEqual(current);
    expect(personal.verify).toHaveBeenCalledTimes(2);
    expect(personal.verify).toHaveBeenLastCalledWith("token");
    const revoked = new McpAuthorizationError("invalid_token", 401);
    personal.verify.mockRejectedValue(revoked);
    oauth.verifyDelegation.mockRejectedValue(revoked);
    await expect(revalidate()).rejects.toMatchObject({ status: 401 });
  });
});

describe("agent API operations", () => {
  it("offers the project-name listing to a verified identity", async () => {
    await expect(
      service.handle("token", { operation: "verify" }),
    ).resolves.toEqual({
      apiVersion: "1",
      identity,
      tools: [
        "projects.names.list",
        ...PAGES_AGENT_READ_OPERATIONS,
        ...PAGES_AGENT_TICKET_READ_OPERATIONS,
        ...PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
        ...PAGES_AGENT_COMMENT_OPERATIONS,
      ],
    });
    expect(projects.listNames).not.toHaveBeenCalled();
  });

  it.each([undefined, {}])(
    "lists names for the credential owner only (parameters %j)",
    async (parameters) => {
      await expect(
        service.handle("token", {
          operation: "projects.names.list",
          parameters,
          userId: "someone-else",
          actor: { isAdmin: true },
        }),
      ).resolves.toEqual({ apiVersion: "1", projectNames: ["Alpha", "Beta"] });
      expect(projects.listNames).toHaveBeenCalledExactlyOnceWith("owner");
    },
  );

  it.each([null, "x", ["x"], { limit: 1 }])(
    "rejects unexpected parameters (%j) before reading any project",
    async (parameters) => {
      await expect(
        service.handle("token", {
          operation: "projects.names.list",
          parameters,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(projects.listNames).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown operations with INVALID_REQUEST", async () => {
    for (const operation of [undefined, "", "projects.create", "projects.list"])
      await expect(
        service.handle("token", { operation }),
      ).rejects.toMatchObject({
        status: 400,
        code: "INVALID_REQUEST",
      });
    expect(projects.listNames).not.toHaveBeenCalled();
  });

  it("dispatches a read only with the freshly verified identity", async () => {
    operations.handle.mockResolvedValue({
      apiVersion: "1",
      result: { id: "alpha", name: "Alpha" },
    });
    const input = {
      operation: "projects.resolve",
      parameters: { name: "Alpha" },
    };
    await expect(service.handle("token", input)).resolves.toMatchObject({
      result: { id: "alpha" },
    });
    expect(operations.handle).toHaveBeenCalledExactlyOnceWith(identity, input);
  });

  it("never reads projects for an unverified, revoked or unavailable credential", async () => {
    personal.verify.mockRejectedValue(
      new McpAuthorizationError("invalid_token", 401),
    );
    oauth.verifyDelegation.mockRejectedValue(
      new McpAuthorizationError("invalid_token", 401),
    );
    await expect(
      service.handle("token", { operation: "projects.names.list" }),
    ).rejects.toMatchObject({ status: 401 });
    personal.verify.mockRejectedValue(new Error("database unavailable"));
    await expect(
      service.handle("token", { operation: "projects.names.list" }),
    ).rejects.toThrow("database unavailable");
    expect(projects.listNames).not.toHaveBeenCalled();
  });

  it("accepts a delegation credential and rejects an OAuth access token", async () => {
    personal.verify.mockRejectedValue(
      new McpAuthorizationError("invalid_token", 401),
    );
    oauth.verifyDelegation.mockResolvedValueOnce(identity);
    await expect(
      service.handle("delegation", { operation: "projects.names.list" }),
    ).resolves.toMatchObject({ projectNames: ["Alpha", "Beta"] });
    oauth.verifyDelegation.mockRejectedValueOnce(
      new McpAuthorizationError("x"),
    );
    await expect(
      service.handle("access-token", { operation: "projects.names.list" }),
    ).rejects.toMatchObject({ status: 401 });
    oauth.verifyDelegation.mockRejectedValueOnce(new Error("unavailable"));
    await expect(service.verify("unavailable")).rejects.toThrow("unavailable");
  });
});
