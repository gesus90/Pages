import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCredentialCommand } from "../../src/credential-command.ts";
import { credentialMessages } from "../../src/credential-messages.ts";
import {
  CredentialStore,
  CredentialStoreError,
} from "../../src/credential-store.ts";
import { postAgentRequest } from "../../src/pages-client.ts";
import { PairingClient } from "../../src/pairing-client.ts";
import { readStdioConfiguration } from "../../src/stdio-configuration.ts";
import { verifyPages } from "../../src/verification.ts";

import type { PagesConfiguration } from "../../src/configuration.ts";
import type { StoredCredential } from "../../src/credential-store.ts";
import type { PagesVerification } from "../../src/verification.ts";

vi.mock("../../src/pages-client.ts", () => ({ postAgentRequest: vi.fn() }));
vi.mock("../../src/verification.ts", () => ({ verifyPages: vi.fn() }));
vi.mock("../../src/stdio-configuration.ts", () => ({
  readStdioConfiguration: vi.fn(),
}));

const MESSAGES = credentialMessages({});
const INSTANCE_HREF = "https://pages.example/";
const URL_ARGUMENTS = ["--url", "https://pages.example"];
const AGENTS_URL = new URL("https://pages.example/api/v1/agents");
const STORED: StoredCredential = {
  tokenId: "token-1",
  token: "a".repeat(43),
  name: "Laptop",
  expiresAt: null,
  pairedAt: 1_700_000_000_000,
};
const ROTATED: StoredCredential = {
  ...STORED,
  tokenId: "token-2",
  token: "b".repeat(43),
};
const VERIFIED: PagesVerification = {
  identity: { userId: "user-1", isAdmin: false, permissions: [] },
  tools: [],
};

const storedCredentials = new Map<string, StoredCredential>();
let messages: string[] = [];

/** Applies a store operation to the in-memory credentials, like the locked file would. */
async function updateStored<Result>(
  instance: URL,
  operation: (current: StoredCredential | null) => Promise<{
    credential: StoredCredential | null;
    result: Result;
  }>,
): Promise<Result> {
  const next = await operation(storedCredentials.get(instance.href) ?? null);
  if (next.credential) storedCredentials.set(instance.href, next.credential);
  else storedCredentials.delete(instance.href);
  return next.result;
}

/** Runs a command against the fake store with captured terminal output. */
async function run(
  argumentsList: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<number> {
  return runCredentialCommand(argumentsList, environment, {
    signal: new AbortController().signal,
    write: (message) => messages.push(message),
  });
}

beforeEach(() => {
  messages = [];
  storedCredentials.clear();
  storedCredentials.set(INSTANCE_HREF, STORED);
  vi.spyOn(CredentialStore.prototype, "get").mockImplementation(
    async (instance) => storedCredentials.get(instance.href) ?? null,
  );
  vi.spyOn(CredentialStore.prototype, "update").mockImplementation(
    updateStored,
  );
  vi.spyOn(PairingClient.prototype, "begin");
  vi.mocked(postAgentRequest).mockReset().mockResolvedValue({});
  vi.mocked(verifyPages).mockReset().mockResolvedValue(VERIFIED);
  vi.mocked(readStdioConfiguration).mockReset().mockResolvedValue({
    agentsUrl: AGENTS_URL,
    token: STORED.token,
  });
});

describe("credential command argument errors", () => {
  it.each([
    { reason: "no command", argumentsList: [] },
    { reason: "an unknown command", argumentsList: ["sync", ...URL_ARGUMENTS] },
    { reason: "an unknown flag", argumentsList: ["status", "--token", "x"] },
    {
      reason: "a repeated --url",
      argumentsList: ["status", ...URL_ARGUMENTS, ...URL_ARGUMENTS],
    },
    { reason: "a missing --url value", argumentsList: ["status", "--url"] },
    { reason: "an empty --url value", argumentsList: ["unpair", "--url", ""] },
    { reason: "a URL without scheme", argumentsList: ["rotate", "--url", "x"] },
    {
      reason: "--no-browser outside pair",
      argumentsList: ["rotate", ...URL_ARGUMENTS, "--no-browser"],
    },
    {
      reason: "--name outside pair",
      argumentsList: ["status", ...URL_ARGUMENTS, "--name", "Laptop"],
    },
    { reason: "no URL at all", argumentsList: ["status"] },
  ])("rejects $reason with exit 4", async ({ argumentsList }) => {
    await expect(run(argumentsList)).resolves.toBe(4);
    expect(messages).toEqual([MESSAGES.wrong]);
    expect(CredentialStore.prototype.get).not.toHaveBeenCalled();
    expect(PairingClient.prototype.begin).not.toHaveBeenCalled();
  });

  it("rejects an insecure PAGES_URL fallback", async () => {
    await expect(
      run(["status"], { PAGES_URL: "http://pages.example" }),
    ).resolves.toBe(4);
    expect(messages).toEqual([MESSAGES.wrong]);
  });

  it("prefers --url over PAGES_URL", async () => {
    await expect(
      run(["status", ...URL_ARGUMENTS], { PAGES_URL: "ftp://elsewhere" }),
    ).resolves.toBe(0);
  });

  it("writes German messages for a German locale", async () => {
    await expect(run(["status"], { LANG: "de_DE.UTF-8" })).resolves.toBe(4);
    expect(messages).toEqual([credentialMessages({ LANG: "de" }).wrong]);
  });
});

describe("credential command store failures", () => {
  it.each(["status", "rotate", "unpair"])(
    "%s reports a missing pairing with exit 1",
    async (command) => {
      storedCredentials.clear();

      await expect(run([command, ...URL_ARGUMENTS])).resolves.toBe(1);
      expect(messages).toEqual([MESSAGES.unpaired, MESSAGES.unpaired]);
      expect(postAgentRequest).not.toHaveBeenCalled();
    },
  );

  it("reports the fixed store diagnostic with exit 1", async () => {
    const failure = new CredentialStoreError();
    vi.mocked(CredentialStore.prototype.get).mockRejectedValue(failure);

    await expect(run(["status", ...URL_ARGUMENTS])).resolves.toBe(1);
    expect(messages).toEqual([failure.message]);
  });
});

describe("unpair", () => {
  it("revokes the credential on Pages and removes it locally", async () => {
    await expect(run(["unpair", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(postAgentRequest).toHaveBeenCalledExactlyOnceWith(
      { agentsUrl: AGENTS_URL, token: STORED.token },
      { operation: "credential.revoke", parameters: {} },
    );
    expect(storedCredentials.has(INSTANCE_HREF)).toBe(false);
    expect(messages).toEqual([MESSAGES.removed]);
  });

  it("removes the credential locally when Pages is unreachable", async () => {
    vi.mocked(postAgentRequest).mockRejectedValue(new Error("offline"));

    await expect(run(["unpair", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(storedCredentials.has(INSTANCE_HREF)).toBe(false);
    expect(messages).toEqual([MESSAGES.offlineRemoved]);
  });

  it("keeps a credential that another process rotated meanwhile", async () => {
    vi.mocked(postAgentRequest).mockImplementation(async () => {
      storedCredentials.set(INSTANCE_HREF, ROTATED);
      return {};
    });

    await expect(run(["unpair", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(storedCredentials.get(INSTANCE_HREF)).toEqual(ROTATED);
    expect(messages).toEqual([MESSAGES.removed]);
  });

  it("tolerates a credential that another process removed meanwhile", async () => {
    vi.mocked(postAgentRequest).mockImplementation(async () => {
      storedCredentials.delete(INSTANCE_HREF);
      return {};
    });

    await expect(run(["unpair", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(storedCredentials.has(INSTANCE_HREF)).toBe(false);
  });
});

describe("rotate", () => {
  it("rotates the stored credential and verifies the new one", async () => {
    const rotate = vi.fn(async () => ROTATED.token);
    const configuration: PagesConfiguration = {
      agentsUrl: AGENTS_URL,
      token: STORED.token,
      credentials: { refresh: vi.fn(), rotate },
    };
    vi.mocked(readStdioConfiguration).mockResolvedValue(configuration);

    await expect(
      run(["rotate", ...URL_ARGUMENTS], {
        PAGES_URL: "https://ignored.example",
        PAGES_TOKEN: "explicit",
        LANG: "en_US",
      }),
    ).resolves.toBe(0);

    expect(readStdioConfiguration).toHaveBeenCalledExactlyOnceWith({
      PAGES_URL: INSTANCE_HREF,
      PAGES_TOKEN: undefined,
      LANG: "en_US",
    });
    expect(rotate).toHaveBeenCalledExactlyOnceWith(STORED.token);
    expect(verifyPages).toHaveBeenCalledExactlyOnceWith(configuration);
    expect(messages).toEqual([MESSAGES.rotated]);
  });

  it("still verifies a configuration without a credential lifecycle", async () => {
    await expect(run(["rotate", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(verifyPages).toHaveBeenCalledExactlyOnceWith({
      agentsUrl: AGENTS_URL,
      token: STORED.token,
    });
    expect(messages).toEqual([MESSAGES.rotated]);
  });

  it("reports a failed verification after rotation with exit 1", async () => {
    vi.mocked(verifyPages).mockRejectedValue(new Error("unauthorized"));

    await expect(run(["rotate", ...URL_ARGUMENTS])).resolves.toBe(1);
    expect(messages).toEqual([MESSAGES.failed]);
  });
});

describe("status", () => {
  it("prefers the credential details Pages just verified", async () => {
    const expiresAt = 1_900_000_000_000;
    vi.mocked(verifyPages).mockResolvedValue({
      ...VERIFIED,
      credential: {
        id: "token-1",
        name: "Server name",
        expiresAt,
        rotationRequested: false,
      },
    });

    await expect(run(["status", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(messages).toEqual([
      `${MESSAGES.paired} ${INSTANCE_HREF}: Server name, ${MESSAGES.expires}: ${new Date(expiresAt).toLocaleString()}.`,
    ]);
  });

  it("rereads the store after a verification that refreshed the credential", async () => {
    vi.mocked(verifyPages).mockImplementation(async () => {
      storedCredentials.set(INSTANCE_HREF, { ...ROTATED, name: "Refreshed" });
      return VERIFIED;
    });

    await expect(run(["status", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(messages).toEqual([
      `${MESSAGES.paired} ${INSTANCE_HREF}: Refreshed, ${MESSAGES.expires}: ${MESSAGES.unlimited}.`,
    ]);
  });

  it("falls back to the initially read credential when the entry vanished", async () => {
    vi.mocked(verifyPages).mockImplementation(async () => {
      storedCredentials.delete(INSTANCE_HREF);
      return VERIFIED;
    });

    await expect(run(["status", ...URL_ARGUMENTS])).resolves.toBe(0);

    expect(messages).toEqual([
      `${MESSAGES.paired} ${INSTANCE_HREF}: Laptop, ${MESSAGES.expires}: ${MESSAGES.unlimited}.`,
    ]);
  });
});
