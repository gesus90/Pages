import { hostname } from "node:os";

import { beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../../package.json" with { type: "json" };
import { runCredentialCommand } from "../../src/credential-command.ts";
import { credentialMessages } from "../../src/credential-messages.ts";
import { CredentialStore } from "../../src/credential-store.ts";
import { postAgentRequest } from "../../src/pages-client.ts";
import { PairingClient, PairingClientError } from "../../src/pairing-client.ts";
import { verifyPages } from "../../src/verification.ts";

import type * as NodeOs from "node:os";
import type { McpPairedCredential } from "../../../definition/McpPairing.ts";
import type { CredentialCommandRuntime } from "../../src/credential-command.ts";
import type { StoredCredential } from "../../src/credential-store.ts";
import type { DevicePairingRequest } from "../../src/pairing-client.ts";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  hostname: vi.fn(),
}));
vi.mock("../../src/pages-client.ts", () => ({ postAgentRequest: vi.fn() }));
vi.mock("../../src/verification.ts", () => ({ verifyPages: vi.fn() }));

const MESSAGES = credentialMessages({});
const START = Date.UTC(2026, 9, 14, 12);
const INSTANCE_HREF = "https://pages.example/";
const PAIR_ARGUMENTS = ["pair", "--url", "https://pages.example"];
const REQUEST: DevicePairingRequest = {
  userCode: "BCDF-GHJK",
  deviceSecret: "s".repeat(43),
  expiresAt: START + 600_000,
  interval: 5,
};
const ISSUED: McpPairedCredential = {
  token: "a".repeat(43),
  tokenId: "token-new",
  name: "Pages MCP",
  expiresAt: null,
  account: { displayName: "Ada Lovelace", username: "ada" },
};
const PREVIOUS: StoredCredential = {
  tokenId: "token-old",
  token: "b".repeat(43),
  name: "Old laptop",
  expiresAt: null,
  pairedAt: START - 1000,
};

interface Harness {
  readonly messages: string[];
  readonly waits: number[];
  readonly controller: AbortController;
  readonly runtime: Required<CredentialCommandRuntime>;
}

const storedCredentials = new Map<string, StoredCredential>();
let currentTime = START;

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

/** Builds terminal boundaries whose waits advance the fake clock. */
function createHarness({ browserOpens = false } = {}): Harness {
  const messages: string[] = [];
  const waits: number[] = [];
  const controller = new AbortController();
  return {
    messages,
    waits,
    controller,
    runtime: {
      signal: controller.signal,
      write: (message) => messages.push(message),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      openBrowser: vi.fn(async () => browserOpens),
    },
  };
}

beforeEach(() => {
  currentTime = START;
  storedCredentials.clear();
  vi.spyOn(Date, "now").mockImplementation(() => currentTime);
  vi.mocked(hostname).mockReset().mockReturnValue("workstation");
  vi.mocked(verifyPages)
    .mockReset()
    .mockResolvedValue({
      identity: { userId: "user-1", isAdmin: false, permissions: [] },
      tools: [],
    });
  vi.mocked(postAgentRequest).mockReset().mockResolvedValue({});
  vi.spyOn(CredentialStore.prototype, "update").mockImplementation(
    updateStored,
  );
  vi.spyOn(PairingClient.prototype, "begin").mockResolvedValue(REQUEST);
  vi.spyOn(PairingClient.prototype, "exchange").mockResolvedValue(ISSUED);
  vi.spyOn(PairingClient.prototype, "cancel").mockResolvedValue();
});

describe("pair success", () => {
  it("shows the code, opens the browser and saves the verified credential", async () => {
    const harness = createHarness({ browserOpens: true });
    vi.mocked(hostname).mockReturnValue("h".repeat(120));

    const exit = await runCredentialCommand(
      [...PAIR_ARGUMENTS, "--name", "  Laptop  "],
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(PairingClient.prototype.begin).toHaveBeenCalledWith(
      {
        clientName: "Laptop",
        device: "h".repeat(100),
        packageVersion: manifest.version,
      },
      harness.controller.signal,
    );
    const link = "https://pages.example/pair?code=BCDF-GHJK";
    expect(harness.runtime.openBrowser).toHaveBeenCalledWith(new URL(link));
    expect(harness.messages[0]).toContain(`${MESSAGES.link}: ${link}`);
    expect(harness.messages[0]).toContain(`${MESSAGES.code}: BCDF-GHJK`);
    expect(harness.messages[0]).not.toContain(REQUEST.deviceSecret);
    expect(harness.messages.slice(1, 3)).toEqual([
      MESSAGES.opened,
      MESSAGES.waiting,
    ]);
    expect(harness.waits).toEqual([5000]);
    expect(verifyPages).toHaveBeenCalledWith({
      agentsUrl: new URL("https://pages.example/api/v1/agents"),
      token: ISSUED.token,
    });
    expect(storedCredentials.get(INSTANCE_HREF)).toEqual({
      tokenId: "token-new",
      token: ISSUED.token,
      name: "Pages MCP",
      expiresAt: null,
      pairedAt: START + 5000,
    });
    expect(postAgentRequest).not.toHaveBeenCalled();
    expect(harness.messages.at(-1)).toBe(
      `${MESSAGES.connected} Ada Lovelace (ada). ${MESSAGES.saved}: Pages MCP, ${MESSAGES.expires}: ${MESSAGES.unlimited}.\n${MESSAGES.configuration}${INSTANCE_HREF}`,
    );
  });

  it("falls back to terminal instructions and revokes the replaced credential", async () => {
    const harness = createHarness();
    const expiresAt = START + 86_400_000;
    storedCredentials.set(INSTANCE_HREF, PREVIOUS);
    vi.mocked(PairingClient.prototype.exchange).mockResolvedValue({
      ...ISSUED,
      expiresAt,
    });

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(harness.messages[1]).toBe(
      `${MESSAGES.fallback} https://pages.example/pair`,
    );
    expect(postAgentRequest).toHaveBeenCalledExactlyOnceWith(
      {
        agentsUrl: new URL("https://pages.example/api/v1/agents"),
        token: PREVIOUS.token,
      },
      { operation: "credential.revoke", parameters: {} },
    );
    expect(storedCredentials.get(INSTANCE_HREF)?.tokenId).toBe("token-new");
    expect(harness.messages).not.toContain(MESSAGES.offlineRemoved);
    expect(harness.messages.at(-1)).toContain(
      `${MESSAGES.expires}: ${new Date(expiresAt).toLocaleString()}.`,
    );
  });

  it("keeps the new credential when the replaced one cannot be revoked", async () => {
    const harness = createHarness();
    storedCredentials.set(INSTANCE_HREF, PREVIOUS);
    vi.mocked(postAgentRequest).mockRejectedValue(new Error("offline"));

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(harness.messages).toContain(MESSAGES.offlineRemoved);
    expect(storedCredentials.get(INSTANCE_HREF)?.token).toBe(ISSUED.token);
  });
});

describe("pair options and verification", () => {
  it("uses PAGES_URL and the default client name", async () => {
    const harness = createHarness();

    const exit = await runCredentialCommand(
      ["pair"],
      { PAGES_URL: "http://127.0.0.1:3000" },
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(PairingClient.prototype.begin).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "Pages MCP" }),
      harness.controller.signal,
    );
    expect(harness.runtime.openBrowser).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3000/pair?code=BCDF-GHJK"),
    );
  });

  it("accepts a name of exactly 100 characters", async () => {
    const harness = createHarness();

    const exit = await runCredentialCommand(
      [...PAIR_ARGUMENTS, "--name", "n".repeat(100)],
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(PairingClient.prototype.begin).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "n".repeat(100) }),
      harness.controller.signal,
    );
  });

  it("reports a handoff failure when the issued credential does not verify", async () => {
    const harness = createHarness();
    vi.mocked(verifyPages).mockRejectedValue(new Error("unauthorized"));

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(1);
    expect(harness.messages.at(-1)).toBe(MESSAGES.handoff);
    expect(storedCredentials.size).toBe(0);
    expect(PairingClient.prototype.cancel).not.toHaveBeenCalled();
  });
});

describe("pair argument errors", () => {
  it.each([
    {
      reason: "a repeated --no-browser",
      extra: ["--no-browser", "--no-browser"],
    },
    { reason: "a repeated --name", extra: ["--name", "A", "--name", "B"] },
    { reason: "a missing name value", extra: ["--name"] },
    { reason: "a blank name", extra: ["--name", "   "] },
    {
      reason: "a name over 100 characters",
      extra: ["--name", "n".repeat(101)],
    },
    { reason: "a control character", extra: ["--name", "bad\u0007name"] },
    { reason: "a format character", extra: ["--name", "bad​name"] },
  ])("rejects $reason before any request", async ({ extra }) => {
    const harness = createHarness();

    const exit = await runCredentialCommand(
      [...PAIR_ARGUMENTS, ...extra],
      {},
      harness.runtime,
    );

    expect(exit).toBe(4);
    expect(harness.messages).toEqual([MESSAGES.wrong]);
    expect(PairingClient.prototype.begin).not.toHaveBeenCalled();
  });

  it.each([
    { code: "wrong_instance" as const, exit: 4, message: MESSAGES.wrong },
    { code: "network" as const, exit: 1, message: MESSAGES.failed },
  ])(
    "reports $code from the pairing request",
    async ({ code, exit, message }) => {
      const harness = createHarness();
      vi.mocked(PairingClient.prototype.begin).mockRejectedValue(
        new PairingClientError(code),
      );

      await expect(
        runCredentialCommand(PAIR_ARGUMENTS, {}, harness.runtime),
      ).resolves.toBe(exit);
      expect(harness.messages).toEqual([message]);
      expect(harness.runtime.openBrowser).not.toHaveBeenCalled();
    },
  );
});
