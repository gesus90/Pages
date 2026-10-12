import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCredentialCommand } from "../../mcp/src/credential-command";

import type { CredentialCommandRuntime } from "../../mcp/src/credential-command";
import { CredentialStore } from "../../mcp/src/credential-store";
import { PairingClient } from "../../mcp/src/pairing-client";

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(async () => undefined),
}));

const instance = "http://192.168.1.8:4567";
const instanceUrl = new URL(instance);
const secret = "s".repeat(43);
const issuedToken = "n".repeat(43);
const storedToken = "a".repeat(43);
const stored = {
  tokenId: "stored-id",
  token: storedToken,
  name: "Workstation",
  expiresAt: null,
  pairedAt: 1,
};
const verifyEnvelope = {
  apiVersion: "1",
  identity: { userId: "user", isAdmin: false, permissions: [] },
  tools: [],
};

interface AgentCall {
  readonly operation: string;
  readonly authorization: string;
}

type AgentHandler = (call: AgentCall) => Response | Promise<Response>;

let directory: string;
let output: string[];
let agentCalls: AgentCall[];
let tokenRequests: number;
let cancelRequests: number;

function environment(): Record<string, string> {
  return { XDG_CONFIG_HOME: directory, PAGES_URL: instance, LANG: "en_US" };
}

function runtime(
  openBrowser: () => Promise<boolean> = async () => false,
): CredentialCommandRuntime {
  return {
    write: (message) => output.push(message),
    wait: async (milliseconds) => {
      vi.setSystemTime(Date.now() + milliseconds);
    },
    openBrowser,
  };
}

function beginResponse(): Response {
  return Response.json(
    {
      apiVersion: "1",
      service: "pages",
      userCode: "BCDF-GHJK",
      deviceSecret: secret,
      expiresAt: Date.now() + 600_000,
      interval: 5,
    },
    { status: 201 },
  );
}

function issuedResponse(): Response {
  return Response.json({
    token: issuedToken,
    tokenId: "issued-id",
    name: "Issued client",
    expiresAt: null,
    account: { displayName: "Erika", username: "erika" },
  });
}

/** Routes pairing endpoints to fixed answers and agent calls to the handler. */
function stubPages(agents: AgentHandler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (address: URL, init: RequestInit) => {
    const pathname = new URL(String(address)).pathname;
    if (pathname === "/api/v1/pairing") return beginResponse();
    if (pathname === "/api/v1/pairing/token") {
      tokenRequests += 1;
      return issuedResponse();
    }
    if (pathname === "/api/v1/pairing/cancel") {
      cancelRequests += 1;
      return Response.json({ cancelled: true });
    }
    const body: unknown = JSON.parse(String(init.body));
    const operation =
      typeof body === "object" && body !== null && "operation" in body
        ? String(body.operation)
        : "";
    const call = {
      operation,
      authorization: new Headers(init.headers).get("Authorization") ?? "",
    };
    agentCalls.push(call);
    return agents(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function verifyAnswer(): Response {
  return Response.json(verifyEnvelope);
}

async function storeCredential(): Promise<CredentialStore> {
  const store = new CredentialStore(environment());
  await store.update(instanceUrl, async () => ({
    credential: stored,
    result: undefined,
  }));
  return store;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-a11-10-g7-command-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
  vi.mocked(delay).mockImplementation(async (milliseconds) => {
    vi.setSystemTime(Date.now() + Number(milliseconds));
    return undefined;
  });
  output = [];
  agentCalls = [];
  tokenRequests = 0;
  cancelRequests = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

describe("credential command argument validation", () => {
  it.each([
    ["an unknown command", ["bogus"]],
    ["no command", []],
    ["an unknown option", ["pair", "--bogus", "x"]],
    ["an option without a value", ["pair", "--url"]],
    ["a repeated --url", ["pair", "--url", instance, "--url", instance]],
    ["--name outside of pair", ["status", "--name", "Client"]],
    ["--no-browser outside of pair", ["status", "--no-browser"]],
    ["a repeated --no-browser", ["pair", "--no-browser", "--no-browser"]],
    ["a blank --name", ["pair", "--name", "   "]],
    ["a too long --name", ["pair", "--name", "n".repeat(101)]],
    ["a control character in --name", ["pair", "--name", "bad\u0007name"]],
  ])(
    "rejects %s with exit 4 before any request",
    async (_label, argumentsList) => {
      const fetchMock = stubPages(() => verifyAnswer());
      expect(
        await runCredentialCommand(argumentsList, environment(), runtime()),
      ).toBe(4);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(output).toEqual([
        "This address does not respond as a Pages instance. Check address and port.",
      ]);
    },
  );

  it("rejects a missing PAGES_URL and accepts --url together with a valid --name", async () => {
    const fetchMock = stubPages(() => verifyAnswer());
    expect(
      await runCredentialCommand(
        ["status"],
        { XDG_CONFIG_HOME: directory },
        runtime(),
      ),
    ).toBe(4);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await runCredentialCommand(
        ["pair", "--name", "Named client", "--url", instance],
        { XDG_CONFIG_HOME: directory },
        runtime(),
      ),
    ).toBe(0);
    const begin = fetchMock.mock.calls[0];
    expect(JSON.parse(String(begin?.[1].body))).toMatchObject({
      clientName: "Named client",
    });
  });
});

describe("local credential commands", () => {
  it.each(["status", "unpair", "rotate"])(
    "reports an unpaired instance for %s with exit 1 and no request",
    async (command) => {
      const fetchMock = stubPages(() => verifyAnswer());
      expect(
        await runCredentialCommand([command], environment(), runtime()),
      ).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(output.length).toBeGreaterThan(0);
      for (const line of output)
        expect(line).toBe("Not paired. Run pair first.");
    },
  );

  it("surfaces an unusable credential file without printing a secret", async () => {
    await storeCredential();
    await chmod(path.join(directory, "pages-mcp"), 0o755);
    stubPages(() => verifyAnswer());
    expect(
      await runCredentialCommand(["status"], environment(), runtime()),
    ).toBe(1);
    expect(output.join(" ")).toContain("0700");
    expect(output.join(" ")).not.toContain(storedToken);
  });

  it("unpair revokes with the stored credential and removes the local entry", async () => {
    const store = await storeCredential();
    stubPages(() => Response.json({ revoked: true }));
    expect(
      await runCredentialCommand(["unpair"], environment(), runtime()),
    ).toBe(0);
    expect(agentCalls).toEqual([
      {
        operation: "credential.revoke",
        authorization: `Bearer ${storedToken}`,
      },
    ]);
    expect(await store.get(instanceUrl)).toBeNull();
    expect(output).toEqual(["Connection revoked and removed locally."]);
  });

  it("unpair keeps an entry that another process replaced while revoking", async () => {
    const store = await storeCredential();
    const replacement = { ...stored, token: "b".repeat(43) };
    stubPages(async () => {
      await store.update(instanceUrl, async () => ({
        credential: replacement,
        result: undefined,
      }));
      return Response.json({ revoked: true });
    });
    expect(
      await runCredentialCommand(["unpair"], environment(), runtime()),
    ).toBe(0);
    expect(await store.get(instanceUrl)).toEqual(replacement);
  });

  it("rotate replaces the stored token, verifies it and keeps the credential id", async () => {
    const store = await storeCredential();
    stubPages(({ operation }) =>
      operation === "credential.rotate"
        ? Response.json({ token: issuedToken, expiresAt: null })
        : verifyAnswer(),
    );
    expect(
      await runCredentialCommand(["rotate"], environment(), runtime()),
    ).toBe(0);
    expect(agentCalls.map((call) => call.operation)).toEqual([
      "credential.rotate",
      "verify",
    ]);
    expect(agentCalls[1]?.authorization).toBe(`Bearer ${issuedToken}`);
    const rotated = await store.get(instanceUrl);
    expect(rotated?.token).toBe(issuedToken);
    expect(rotated?.tokenId).toBe(stored.tokenId);
    expect(output).toEqual(["Access renewed."]);
  });

  it("rotate fails with exit 1 when Pages answers with an unusable replacement", async () => {
    const store = await storeCredential();
    stubPages(() => Response.json({ token: "invalid token", expiresAt: null }));
    expect(
      await runCredentialCommand(["rotate"], environment(), runtime()),
    ).toBe(1);
    expect(output.join(" ")).toContain("invalid rotation response");
    expect(await store.get(instanceUrl)).toEqual(stored);
  });

  it("status falls back to the local entry when the server sends no credential details", async () => {
    await storeCredential();
    stubPages(() => verifyAnswer());
    expect(
      await runCredentialCommand(["status"], environment(), runtime()),
    ).toBe(0);
    expect(output).toEqual([
      `Paired with ${instanceUrl.href}: Workstation, Valid until: unlimited.`,
    ]);
  });

  it("status still reports the verified credential when the local entry vanished meanwhile", async () => {
    const store = await storeCredential();
    stubPages(async () => {
      await store.update(instanceUrl, async () => ({
        credential: null,
        result: undefined,
      }));
      return verifyAnswer();
    });
    expect(
      await runCredentialCommand(["status"], environment(), runtime()),
    ).toBe(0);
    expect(output.join(" ")).toContain("Workstation");
  });
});

describe("pairing flow variants", () => {
  it("announces an opened browser and revokes the previous credential after a successful handoff", async () => {
    const store = await storeCredential();
    stubPages(() => verifyAnswer());
    expect(
      await runCredentialCommand(
        ["pair"],
        environment(),
        runtime(async () => true),
      ),
    ).toBe(0);
    expect(output).toContain("Browser opened.");
    expect(agentCalls).toEqual([
      { operation: "verify", authorization: `Bearer ${issuedToken}` },
      {
        operation: "credential.revoke",
        authorization: `Bearer ${storedToken}`,
      },
    ]);
    expect((await store.get(instanceUrl))?.token).toBe(issuedToken);
    expect(output.join(" ")).toContain("Connected as Erika (erika)");
    expect(output.join(" ")).toContain("unlimited");
    expect(output.join(" ")).not.toContain("Removed locally.");
    expect(output.join(" ")).not.toContain(issuedToken);
  });

  it("still succeeds and points to the settings when the previous credential cannot be revoked", async () => {
    await storeCredential();
    stubPages(({ operation }) =>
      operation === "verify"
        ? verifyAnswer()
        : new Response(null, { status: 500 }),
    );
    expect(await runCredentialCommand(["pair"], environment(), runtime())).toBe(
      0,
    );
    expect(output.join(" ")).toContain("Removed locally.");
    expect(output.join(" ")).toContain("Connected as Erika (erika)");
    expect(
      (await new CredentialStore(environment()).get(instanceUrl))?.token,
    ).toBe(issuedToken);
  });

  it("stores nothing and exits 1 when the issued credential fails verification", async () => {
    stubPages(() => new Response(null, { status: 401 }));
    expect(await runCredentialCommand(["pair"], environment(), runtime())).toBe(
      1,
    );
    expect(output.join(" ")).toContain("The handoff failed.");
    expect(
      await new CredentialStore(environment()).get(instanceUrl),
    ).toBeNull();
    expect(output.join(" ")).not.toContain(issuedToken);
  });

  it("cancels at the first poll when the signal fired and reports a failing cancel request", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(beginResponse())
      .mockRejectedValueOnce(new Error("secret-network"));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await runCredentialCommand(["pair"], environment(), {
        ...runtime(),
        signal: controller.signal,
        wait: async () => controller.abort(),
      }),
    ).toBe(130);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output.join(" ")).toContain("Removed locally.");
    expect(output.join(" ")).toContain("Pairing cancelled.");
    expect(output.join(" ")).not.toContain("secret-network");
    expect(output.join(" ")).not.toContain(secret);
  });

  it("answers an unexpected internal failure with the generic message and exit 1", async () => {
    stubPages(() => verifyAnswer());
    expect(
      await runCredentialCommand(["pair"], environment(), {
        ...runtime(),
        wait: async () => {
          throw new TypeError("secret-internal-detail");
        },
      }),
    ).toBe(1);
    expect(output.at(-1)).toBe(
      "Pairing failed. Check the address and run pair again.",
    );
    expect(output.join(" ")).not.toContain("secret-internal-detail");
    expect(tokenRequests).toBe(0);
  });

  it("does not swallow an unexpected error raised while collecting the credential", async () => {
    stubPages(() => verifyAnswer());
    vi.spyOn(PairingClient.prototype, "exchange").mockRejectedValueOnce(
      new TypeError("secret-internal-detail"),
    );
    expect(await runCredentialCommand(["pair"], environment(), runtime())).toBe(
      1,
    );
    expect(output.at(-1)).toBe(
      "Pairing failed. Check the address and run pair again.",
    );
    expect(output.join(" ")).not.toContain("secret-internal-detail");
    expect(
      await new CredentialStore(environment()).get(instanceUrl),
    ).toBeNull();
  });
});

describe("default terminal boundaries", () => {
  it("writes to stderr, waits on the real timer API and never opens a browser with --no-browser", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    stubPages(() => verifyAnswer());
    const exitCode = await runCredentialCommand(
      ["pair", "--no-browser"],
      environment(),
    );
    const written = stderr.mock.calls.map(([chunk]) => String(chunk));
    stderr.mockRestore();
    expect(exitCode).toBe(0);
    expect(delay).toHaveBeenCalledWith(5000, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(written.every((line) => line.endsWith("\n"))).toBe(true);
    expect(written.join("")).toContain(`${instance}/pair?code=BCDF-GHJK`);
    expect(written.join("")).toContain("Open the link on a device");
    expect(written.join("")).not.toContain(secret);
    expect(written.join("")).not.toContain(issuedToken);
    expect(tokenRequests).toBe(1);
  });

  it("aborts through the process interrupt handler and removes the handler afterwards", async () => {
    const before = process.listenerCount("SIGINT");
    const once = vi.spyOn(process, "once");
    stubPages(() => verifyAnswer());
    const exitCode = await runCredentialCommand(["pair"], environment(), {
      write: (message) => output.push(message),
      openBrowser: async () => false,
      wait: async () => {
        const interrupt = once.mock.calls.find(
          ([event]) => event === "SIGINT",
        )?.[1];
        if (!interrupt) throw new Error("Missing interrupt handler");
        interrupt();
      },
    });
    expect(exitCode).toBe(130);
    expect(cancelRequests).toBe(1);
    expect(tokenRequests).toBe(0);
    expect(output).toContain("Pairing cancelled.");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
