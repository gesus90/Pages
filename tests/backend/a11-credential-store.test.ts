import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialStore,
  CredentialStoreError,
  credentialDirectory,
  isStoredCredential,
} from "../../mcp/src/credential-store";
import { runCredentialCommand } from "../../mcp/src/credential-command";
import { readStdioConfiguration } from "../../mcp/src/stdio-configuration";
import { readConfiguration } from "../../mcp/src/configuration";
import { verifyPages } from "../../mcp/src/verification";
import { postAgentRequest } from "../../mcp/src/pages-client";
import { openPairingBrowser } from "../../mcp/src/pairing-browser";

let directory: string;
const instance = new URL("http://192.168.1.7:4567");
const stored = {
  tokenId: "connection-id",
  token: "a".repeat(43),
  name: "Workstation",
  expiresAt: null,
  pairedAt: 1,
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-a11-credentials-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function environment() {
  return { XDG_CONFIG_HOME: directory, PAGES_URL: instance.href, LANG: "en" };
}

describe("A11.2 private credential persistence and lifecycle", () => {
  it("writes 0700/0600 atomically and preserves independent instances under concurrent writers", async () => {
    const store = new CredentialStore(environment());
    const other = new URL("https://pages.invalid:5678");
    await Promise.all([
      store.update(instance, async () => ({
        credential: stored,
        result: undefined,
      })),
      store.update(other, async () => ({
        credential: { ...stored, token: "b".repeat(43) },
        result: undefined,
      })),
    ]);
    expect(await store.get(instance)).toEqual(stored);
    expect(await store.get(new URL("http://192.168.1.7:4568"))).toBeNull();
    expect((await store.get(other))?.token).toBe("b".repeat(43));
    expect((await stat(path.join(directory, "pages-mcp"))).mode & 0o777).toBe(
      0o700,
    );
    expect(
      (await stat(path.join(directory, "pages-mcp", "credentials.json"))).mode &
        0o777,
    ).toBe(0o600);
    expect(
      await readFile(
        path.join(directory, "pages-mcp", "credentials.json"),
        "utf8",
      ),
    ).toContain(instance.href);
  });

  it("refuses permissive directories, permissive files and symbolic links", async () => {
    const store = new CredentialStore(environment());
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    const folder = path.join(directory, "pages-mcp");
    const filename = path.join(folder, "credentials.json");
    await chmod(folder, 0o755);
    await expect(store.get(instance)).rejects.toThrow(/0700/);
    await chmod(folder, 0o700);
    await chmod(filename, 0o644);
    await expect(store.get(instance)).rejects.toThrow(/0600/);
    await chmod(filename, 0o600);
    await rm(filename);
    await symlink(path.join(directory, "target"), filename);
    await expect(store.get(instance)).rejects.toThrow(/permissions/);
  });

  it("gives PAGES_TOKEN priority without reading or changing local credentials", async () => {
    const store = new CredentialStore(environment());
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    await chmod(path.join(directory, "pages-mcp"), 0o755);
    const configuration = await readStdioConfiguration({
      ...environment(),
      PAGES_TOKEN: "explicit-token",
    });
    expect(configuration.token).toBe("explicit-token");
    expect(configuration.credentials).toBeUndefined();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        apiVersion: "1",
        identity: { userId: "user", isAdmin: false, permissions: [] },
        tools: [],
        credential: {
          id: stored.tokenId,
          name: stored.name,
          expiresAt: null,
          rotationRequested: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await verifyPages(configuration);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(configuration.token).toBe("explicit-token");
    await expect(
      readStdioConfiguration({ ...environment(), PAGES_TOKEN: "" }),
    ).rejects.toThrow(/PAGES_TOKEN/);
  });

  it("accepts private IPv4 HTTP without a warning and keeps the instance prefix distinct", async () => {
    expect(
      readConfiguration({ PAGES_URL: instance.href, PAGES_TOKEN: "explicit" })
        .agentsUrl.href,
    ).toBe(`${instance.origin}/api/v1/agents`);
    for (const address of [
      "http://172.16.0.1",
      "http://10.2.3.4",
      "http://192.168.0.1",
    ])
      expect(
        readConfiguration({ PAGES_URL: address, PAGES_TOKEN: "explicit" })
          .token,
      ).toBe("explicit");
    expect(() =>
      readConfiguration({
        PAGES_URL: "http://172.32.0.1",
        PAGES_TOKEN: "explicit",
      }),
    ).toThrow();
    const store = new CredentialStore(environment());
    await store.update(new URL("https://pages.invalid/team-a"), async () => ({
      credential: stored,
      result: undefined,
    }));
    expect(await store.get(new URL("https://pages.invalid/team-b"))).toBeNull();
  });

  it("rotates only a stored credential, keeps its id and retries a concurrent refresh once", async () => {
    const store = new CredentialStore(environment());
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    const replacement = "b".repeat(43);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        const input: unknown = JSON.parse(String(init.body));
        calls.push(JSON.stringify(input));
        if (calls.at(-1)?.includes("credential.rotate"))
          return Response.json({ token: replacement, expiresAt: null });
        const authorization = new Headers(init.headers).get("Authorization");
        return Response.json({
          apiVersion: "1",
          identity: { userId: "user", isAdmin: false, permissions: [] },
          tools: [],
          credential: {
            id: stored.tokenId,
            name: stored.name,
            expiresAt: null,
            rotationRequested: authorization === `Bearer ${stored.token}`,
          },
        });
      }),
    );
    const configuration = await readStdioConfiguration(environment());
    await verifyPages(configuration);
    expect(configuration.token).toBe(replacement);
    expect((await store.get(instance))?.tokenId).toBe(stored.tokenId);
    expect(
      calls.filter((call) => call.includes("credential.rotate")),
    ).toHaveLength(1);
    const outdated = await readStdioConfiguration(environment());
    await store.update(instance, async (current) => ({
      credential: current ? { ...current, token: "c".repeat(43) } : null,
      result: undefined,
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "invalid_token" }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ result: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await postAgentRequest(outdated, { operation: "verify", parameters: {} }),
    ).toEqual({ result: "ok" });
    expect(fetchMock.mock.calls[1]?.[1].headers.Authorization).toBe(
      `Bearer ${"c".repeat(43)}`,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "invalid_token" }, { status: 401 }),
        ),
    );
    await expect(
      postAgentRequest(outdated, { operation: "verify", parameters: {} }),
    ).rejects.toThrow(/pair/);
    expect(await store.get(instance)).toBeNull();
  });

  it("removes a concurrently refreshed credential when the single retry is also rejected", async () => {
    const store = new CredentialStore(environment());
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    const configuration = await readStdioConfiguration(environment());
    await store.update(instance, async () => ({
      credential: { ...stored, token: "b".repeat(43) },
      result: undefined,
    }));
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ error: "invalid_token" }, { status: 401 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      postAgentRequest(configuration, { operation: "verify", parameters: {} }),
    ).rejects.toThrow(/pair/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await store.get(instance)).toBeNull();
  });

  it("does not automatically open a browser over SSH, without a desktop or with --no-browser", async () => {
    for (const [env, options] of [
      [
        { DISPLAY: ":0", SSH_CONNECTION: "ssh" },
        { isTerminal: true, noBrowser: false },
      ],
      [{}, { isTerminal: true, noBrowser: false }],
      [{ DISPLAY: ":0" }, { isTerminal: true, noBrowser: true }],
      [{ DISPLAY: ":0" }, { isTerminal: false, noBrowser: false }],
    ] as const)
      expect(
        await openPairingBrowser(instance, env, {
          ...options,
          platform: "linux",
        }),
      ).toBe(false);
  });

  it("unpair removes its local entry even when Pages is unreachable", async () => {
    const store = new CredentialStore(environment());
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret-network-diagnostic")),
    );
    const output: string[] = [];
    expect(
      await runCredentialCommand(["unpair"], environment(), {
        write: (text) => output.push(text),
      }),
    ).toBe(0);
    expect(await store.get(instance)).toBeNull();
    expect(output.join(" ")).toContain("Settings");
    expect(output.join(" ")).not.toContain(stored.token);
    expect(output.join(" ")).not.toContain("secret-network-diagnostic");
  });

  it("status reports the server expiry after a personal validity change", async () => {
    const store = new CredentialStore(environment());
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    const expiresAt = new Date("2026-10-12T12:00:00Z").getTime();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          apiVersion: "1",
          identity: { userId: "user", isAdmin: false, permissions: [] },
          tools: [],
          credential: {
            id: stored.tokenId,
            name: stored.name,
            expiresAt,
            rotationRequested: false,
          },
        }),
      ),
    );
    const output: string[] = [];
    expect(
      await runCredentialCommand(["status"], environment(), {
        write: (message) => output.push(message),
      }),
    ).toBe(0);
    expect(output.join(" ")).toContain(new Date(expiresAt).toLocaleString());
    expect(output.join(" ")).not.toContain(stored.token);
  });
});

it("resolves supported platform directories and rejects relative configuration roots", () => {
  expect(credentialDirectory({ APPDATA: directory }, "win32")).toBe(
    path.join(directory, "pages-mcp"),
  );
  for (const APPDATA of [undefined, "relative"])
    expect(() => credentialDirectory({ APPDATA }, "win32")).toThrow(
      CredentialStoreError,
    );
  expect(credentialDirectory({}, "darwin")).toBe(
    path.join(homedir(), "Library", "Application Support", "pages-mcp"),
  );
  expect(credentialDirectory({}, "linux")).toBe(
    path.join(homedir(), ".config", "pages-mcp"),
  );
  expect(() =>
    credentialDirectory({ XDG_CONFIG_HOME: "relative" }, "linux"),
  ).toThrow(CredentialStoreError);
});

it.each([undefined, null, 1, "token"])(
  "rejects non-object stored credentials %j",
  (input) => {
    expect(isStoredCredential(input)).toBe(false);
  },
);

it.each([
  null,
  [],
  1,
  { "https://pages.invalid": stored },
  { [instance.href]: { ...stored, token: "invalid token" } },
])("rejects malformed credential storage %j", async (input) => {
  const store = new CredentialStore(environment());
  await store.update(instance, async () => ({
    credential: stored,
    result: undefined,
  }));
  await writeFile(
    path.join(directory, "pages-mcp", "credentials.json"),
    JSON.stringify(input),
  );
  await expect(store.get(instance)).rejects.toThrow(CredentialStoreError);
});

it("cleans the temporary file and lock after an atomic rename fails", async () => {
  const store = new CredentialStore(environment());
  const folder = path.join(directory, "pages-mcp");
  await expect(
    store.update(instance, async () => {
      await mkdir(path.join(folder, "credentials.json"));
      return { credential: stored, result: undefined };
    }),
  ).rejects.toMatchObject({ code: "EISDIR" });
  expect(await readdir(folder)).toEqual(["credentials.json"]);
});

it("refuses implicit credential loading for an unpaired instance", async () => {
  await expect(readStdioConfiguration(environment())).rejects.toThrow(/pair/);
});

it("does not retry an explicitly non-retryable rejected credential request", async () => {
  const store = new CredentialStore(environment());
  await store.update(instance, async () => ({
    credential: stored,
    result: undefined,
  }));
  const configuration = await readStdioConfiguration(environment());
  const replacement = { ...stored, token: "b".repeat(43) };
  await store.update(instance, async () => ({
    credential: replacement,
    result: undefined,
  }));
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json({ error: "invalid_token" }, { status: 401 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    postAgentRequest(
      configuration,
      { operation: "credential.rotate", parameters: {} },
      { retryCredential: false },
    ),
  ).rejects.toThrow(/pair/);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(await store.get(instance)).toEqual(replacement);
});

it("reuses a credential rotated concurrently before this caller obtains the lock", async () => {
  const store = new CredentialStore(environment());
  await store.update(instance, async () => ({
    credential: stored,
    result: undefined,
  }));
  const configuration = await readStdioConfiguration(environment());
  const replacement = { ...stored, token: "b".repeat(43) };
  await store.update(instance, async () => ({
    credential: replacement,
    result: undefined,
  }));
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await configuration.credentials?.rotate(stored.token);
  expect(configuration.token).toBe(replacement.token);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses rotation when the local entry was removed meanwhile", async () => {
  const store = new CredentialStore(environment());
  await store.update(instance, async () => ({
    credential: stored,
    result: undefined,
  }));
  const configuration = await readStdioConfiguration(environment());
  await store.update(instance, async () => ({
    credential: null,
    result: undefined,
  }));
  await expect(configuration.credentials?.rotate(stored.token)).rejects.toThrow(
    /pair/,
  );
});

it("rejects malformed rotation responses while retaining the existing credential", async () => {
  const store = new CredentialStore(environment());
  await store.update(instance, async () => ({
    credential: stored,
    result: undefined,
  }));
  const configuration = await readStdioConfiguration(environment());
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ token: "invalid token", expiresAt: null }),
      ),
  );
  await expect(configuration.credentials?.rotate(stored.token)).rejects.toThrow(
    /rotation/,
  );
  expect(await store.get(instance)).toEqual(stored);
});
