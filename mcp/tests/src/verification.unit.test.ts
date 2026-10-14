import { beforeEach, describe, expect, it, vi } from "vitest";

import { postAgentRequest } from "../../src/pages-client.ts";
import { readVerifiedIdentity, verifyPages } from "../../src/verification.ts";

import type { PagesConfiguration } from "../../src/configuration.ts";

vi.mock("../../src/pages-client.ts", () => ({ postAgentRequest: vi.fn() }));

const AGENTS_URL = new URL("https://pages.example/api/v1/agents");
const IDENTITY = { userId: "u1", isAdmin: false, permissions: ["wiki.read"] };
const CREDENTIAL = {
  id: "c1",
  name: "Workstation",
  expiresAt: 1_800_000_000_000,
  rotationRequested: false,
};

function verification(overrides: Record<string, unknown> = {}): unknown {
  return {
    apiVersion: "1",
    identity: IDENTITY,
    tools: ["projects.names.list"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(postAgentRequest).mockReset();
});

describe("readVerifiedIdentity", () => {
  it("keeps only the identity fields", () => {
    expect(
      readVerifiedIdentity({ ...IDENTITY, isAdmin: true, email: "hidden" }),
    ).toEqual({ ...IDENTITY, isAdmin: true });
  });

  it.each([
    null,
    "u1",
    { ...IDENTITY, userId: 1 },
    { ...IDENTITY, userId: "" },
    { ...IDENTITY, isAdmin: "false" },
    { ...IDENTITY, permissions: "wiki.read" },
    { ...IDENTITY, permissions: ["wiki.read", 2] },
  ])("rejects the malformed identity %j", (identity) => {
    expect(() => readVerifiedIdentity(identity)).toThrow(
      "Pages verification failed.",
    );
  });
});

describe("verifyPages", () => {
  const configuration = { agentsUrl: AGENTS_URL, token: "token" };

  it("returns the identity and only the operations this package implements", async () => {
    vi.mocked(postAgentRequest).mockResolvedValue(
      verification({
        tools: ["projects.names.list", "wiki.page.read", "unknown.operation"],
      }),
    );
    await expect(verifyPages(configuration)).resolves.toEqual({
      identity: IDENTITY,
      tools: ["projects.names.list", "wiki.page.read"],
    });
    expect(postAgentRequest).toHaveBeenCalledWith(configuration, {
      operation: "verify",
      parameters: {},
    });
  });

  it("recognizes comment and write operations", async () => {
    vi.mocked(postAgentRequest).mockResolvedValue(
      verification({ tools: ["wiki.comments.read", "wiki.page.create"] }),
    );
    const result = await verifyPages(configuration);
    expect(result.tools).toEqual(["wiki.comments.read", "wiki.page.create"]);
  });

  it.each([
    null,
    "verified",
    verification({ apiVersion: "2" }),
    verification({ tools: "projects.names.list" }),
    verification({ tools: [1] }),
    verification({ identity: null }),
  ])("rejects the unexpected response %j", async (response) => {
    vi.mocked(postAgentRequest).mockResolvedValue(response);
    await expect(verifyPages(configuration)).rejects.toThrow(
      "Pages verification failed.",
    );
  });
});

describe("verifyPages credential details", () => {
  const configuration = { agentsUrl: AGENTS_URL, token: "token" };

  it.each([CREDENTIAL, { ...CREDENTIAL, expiresAt: null, extra: "dropped" }])(
    "returns the credential details %j",
    async (credential) => {
      vi.mocked(postAgentRequest).mockResolvedValue(
        verification({ credential }),
      );
      const result = await verifyPages(configuration);
      expect(result.credential).toEqual({
        id: credential.id,
        name: credential.name,
        expiresAt: credential.expiresAt,
        rotationRequested: false,
      });
    },
  );

  it("omits absent credential details", async () => {
    vi.mocked(postAgentRequest).mockResolvedValue(
      verification({ credential: null }),
    );
    expect(await verifyPages(configuration)).not.toHaveProperty("credential");
  });

  it.each([
    "c1",
    { ...CREDENTIAL, id: undefined },
    { name: "Workstation", expiresAt: null, rotationRequested: false },
    { ...CREDENTIAL, id: 1 },
    { id: "c1", expiresAt: null, rotationRequested: false },
    { ...CREDENTIAL, name: 1 },
    { id: "c1", name: "Workstation", rotationRequested: false },
    { ...CREDENTIAL, expiresAt: "never" },
    { id: "c1", name: "Workstation", expiresAt: null },
    { ...CREDENTIAL, rotationRequested: "yes" },
  ])("rejects the malformed credential details %j", async (credential) => {
    vi.mocked(postAgentRequest).mockResolvedValue(verification({ credential }));
    await expect(verifyPages(configuration)).rejects.toThrow(
      "Pages verification failed.",
    );
  });
});

describe("verifyPages requested rotation", () => {
  it("rotates a paired credential and verifies the replacement", async () => {
    const rotate = vi.fn(async () => "rotated-token");
    const configuration: PagesConfiguration = {
      agentsUrl: AGENTS_URL,
      token: "old-token",
      credentials: { refresh: vi.fn(), rotate },
    };
    vi.mocked(postAgentRequest)
      .mockResolvedValueOnce(
        verification({
          credential: { ...CREDENTIAL, rotationRequested: true },
        }),
      )
      .mockResolvedValueOnce(verification({ credential: CREDENTIAL }));
    await expect(verifyPages(configuration)).resolves.toEqual({
      identity: IDENTITY,
      tools: ["projects.names.list"],
      credential: CREDENTIAL,
    });
    expect(rotate).toHaveBeenCalledWith("old-token");
    expect(postAgentRequest).toHaveBeenLastCalledWith(
      { agentsUrl: AGENTS_URL, token: "rotated-token" },
      { operation: "verify", parameters: {} },
    );
  });

  it("does not rotate an explicit environment credential", async () => {
    const requested = { ...CREDENTIAL, rotationRequested: true };
    vi.mocked(postAgentRequest).mockResolvedValue(
      verification({ credential: requested }),
    );
    const result = await verifyPages({ agentsUrl: AGENTS_URL, token: "env" });
    expect(result.credential).toEqual(requested);
    expect(postAgentRequest).toHaveBeenCalledOnce();
  });
});
