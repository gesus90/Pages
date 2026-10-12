import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCredentialCommand } from "../../mcp/src/credential-command";
import { CredentialStore } from "../../mcp/src/credential-store";

let directory: string;
const instance = "http://192.168.1.8:4567";
const secret = "s".repeat(43);
const token = "t".repeat(43);
const request = {
  apiVersion: "1",
  service: "pages",
  userCode: "BCDF-GHJK",
  deviceSecret: secret,
  expiresAt: 0,
  interval: 5,
};
let output: string[];
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-a11-command-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T22:00:00Z"));
  output = [];
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.useRealTimers();
});
function environment() {
  return {
    XDG_CONFIG_HOME: directory,
    PAGES_URL: instance,
    LANG: "de_DE.UTF-8",
  };
}
function runtime() {
  return {
    write: (text: string) => output.push(text),
    wait: async (milliseconds: number) => {
      vi.setSystemTime(Date.now() + milliseconds);
    },
    openBrowser: async () => false,
  };
}
function beginResponse() {
  return Response.json(
    { ...request, expiresAt: Date.now() + 600_000 },
    { status: 201 },
  );
}

describe("A11.2 pairing terminal commands without network or listeners", () => {
  it("prints a link with the actual host and port, collects once and stores access without printing secrets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(beginResponse())
      .mockResolvedValueOnce(
        Response.json({ error: "authorization_pending" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          token,
          tokenId: "id",
          name: "Client",
          expiresAt: null,
          account: { displayName: "Erika", username: "erika" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          apiVersion: "1",
          identity: { userId: "user", isAdmin: false, permissions: [] },
          tools: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await runCredentialCommand(
        ["pair", "--name", "Test Client", "--no-browser"],
        environment(),
        runtime(),
      ),
    ).toBe(0);
    expect(output.join("\n")).toContain(`${instance}/pair?code=BCDF-GHJK`);
    expect(output.join("\n")).toContain("Verbunden als Erika");
    expect(output.join("\n")).not.toContain(secret);
    expect(output.join("\n")).not.toContain(token);
    expect(
      (await new CredentialStore(environment()).get(new URL(instance)))?.token,
    ).toBe(token);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(secret);
      expect(String(url)).not.toContain(token);
      expect(init.redirect).toBe("error");
    }
  });

  it.each([
    ["access_denied", 2],
    ["expired_token", 3],
    ["invalid_grant", 1],
  ])(
    "returns the expected exit code for %s without storing any token",
    async (code, expected) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(beginResponse())
          .mockResolvedValueOnce(
            Response.json({ error: code }, { status: 400 }),
          ),
      );
      expect(
        await runCredentialCommand(["pair"], environment(), runtime()),
      ).toBe(expected);
      expect(
        await new CredentialStore(environment()).get(new URL(instance)),
      ).toBeNull();
    },
  );

  it("rejects a wrong instance before displaying any code, and rejects unsafe addresses without a request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ...request, service: "imposter" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await runCredentialCommand(["pair"], environment(), runtime())).toBe(
      4,
    );
    expect(output.join(" ")).not.toContain("BCDF-GHJK");
    fetchMock.mockClear();
    expect(
      await runCredentialCommand(
        ["pair", "--url", "http://public.invalid"],
        environment(),
        runtime(),
      ),
    ).toBe(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels its device request on Ctrl+C with exit 130", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(beginResponse())
      .mockResolvedValueOnce(Response.json({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await runCredentialCommand(["pair"], environment(), {
        ...runtime(),
        signal: controller.signal,
        wait: async () => {
          controller.abort();
          throw new Error("aborted");
        },
      }),
    ).toBe(130);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/pairing/cancel");
    expect(output.join(" ")).toContain("Pairing abgebrochen.");
    expect(output.join(" ")).not.toContain(secret);
  });

  it("retries network failures at 5, 10, 20, 30 seconds and stops at its deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(beginResponse())
        .mockRejectedValue(new Error("secret-network")),
    );
    const waits: number[] = [];
    expect(
      await runCredentialCommand(["pair"], environment(), {
        ...runtime(),
        wait: async (milliseconds) => {
          waits.push(milliseconds);
          vi.setSystemTime(Date.now() + milliseconds);
        },
      }),
    ).toBe(3);
    expect(waits.slice(0, 6)).toEqual([5000, 5000, 10000, 20000, 30000, 30000]);
    expect(output.join(" ")).not.toContain("secret-network");
  });

  it("backs off a slow_down response and never follows a redirect", async () => {
    const waits: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(beginResponse())
      .mockResolvedValueOnce(
        Response.json({ error: "slow_down" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "access_denied" }, { status: 400 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await runCredentialCommand(["pair"], environment(), {
        ...runtime(),
        wait: async (milliseconds) => {
          waits.push(milliseconds);
          vi.setSystemTime(Date.now() + milliseconds);
        },
      }),
    ).toBe(2);
    expect(waits).toEqual([5000, 10000]);
    fetchMock.mockReset().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.invalid" },
      }),
    );
    expect(await runCredentialCommand(["pair"], environment(), runtime())).toBe(
      4,
    );
    expect(fetchMock.mock.calls.at(-1)?.[1].redirect).toBe("error");
  });
});
