import { beforeEach, describe, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";

import type { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import type { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";
import type { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";

const identity = { userId: "owner", isAdmin: false, permissions: [] };
const personal = { verify: vi.fn() };
const oauth = { verifyDelegation: vi.fn() };
const projects = { listNames: vi.fn() };
const service = new PagesAgentApiService(
  personal as unknown as PersonalAgentTokenService,
  oauth as unknown as OAuthTokenService,
  projects as unknown as AgentProjectService,
);

beforeEach(() => {
  vi.resetAllMocks();
  personal.verify.mockResolvedValue(identity);
  projects.listNames.mockResolvedValue(["Alpha", "Beta"]);
});

describe("agent API operations", () => {
  it("offers the project-name listing to a verified identity", async () => {
    await expect(
      service.handle("token", { operation: "verify" }),
    ).resolves.toEqual({
      apiVersion: "1",
      identity,
      tools: ["projects.names.list"],
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

  it("forbids every other operation", async () => {
    for (const operation of [undefined, "", "projects.create", "projects.list"])
      await expect(
        service.handle("token", { operation }),
      ).rejects.toMatchObject({
        status: 403,
      });
    expect(projects.listNames).not.toHaveBeenCalled();
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
