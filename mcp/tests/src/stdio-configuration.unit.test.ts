import { beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialStoreError } from "../../src/credential-store.ts";
import { readStdioConfiguration } from "../../src/stdio-configuration.ts";

import type * as CredentialStoreModule from "../../src/credential-store.ts";
import type { StoredCredential } from "../../src/credential-store.ts";
import type { PagesConfiguration } from "../../src/configuration.ts";

interface CredentialUpdate {
  readonly credential: StoredCredential | null;
  readonly result: unknown;
}

const mocks = vi.hoisted(() => ({
  state: { credential: null as StoredCredential | null },
  constructed:
    vi.fn<(environment: Record<string, string | undefined>) => void>(),
  get: vi.fn<(instance: URL) => void>(),
  update: vi.fn<(instance: URL) => void>(),
  postAgentRequest: vi.fn<(...input: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../src/credential-store.ts", async (importOriginal) => {
  const original = await importOriginal<typeof CredentialStoreModule>();

  /** In-memory store holding one credential for the requested instance. */
  class FakeCredentialStore {
    public constructor(environment: Record<string, string | undefined>) {
      mocks.constructed(environment);
    }

    /** Returns the held credential and records the instance. */
    public async get(instance: URL): Promise<StoredCredential | null> {
      mocks.get(instance);
      return mocks.state.credential;
    }

    /** Applies the operation to the held credential like the real store. */
    public async update(
      instance: URL,
      operation: (
        current: StoredCredential | null,
      ) => Promise<CredentialUpdate>,
    ): Promise<unknown> {
      mocks.update(instance);
      const next = await operation(mocks.state.credential);
      mocks.state.credential = next.credential;
      return next.result;
    }
  }

  return { ...original, CredentialStore: FakeCredentialStore };
});
vi.mock("../../src/pages-client.ts", () => ({
  postAgentRequest: mocks.postAgentRequest,
}));

const PAGES_URL = "https://pages.example/base/";
const INSTANCE = new URL("https://pages.example/base");
const AGENTS_URL = new URL("https://pages.example/base/api/v1/agents");
const ENVIRONMENT = { PAGES_URL, XDG_CONFIG_HOME: "/synthetic/config" };
const STORED_TOKEN = "a".repeat(43);
const ROTATED_TOKEN = "b".repeat(43);
const OTHER_TOKEN = "c".repeat(43);
const CREDENTIAL: StoredCredential = {
  tokenId: "token-1",
  token: STORED_TOKEN,
  name: "Synthetic client",
  expiresAt: 1_800_000_000_000,
  pairedAt: 1_700_000_000_000,
};
const INVALID_ROTATION =
  "Pages returned an invalid rotation response. Pair the client again.";

async function readPairedConfiguration(): Promise<PagesConfiguration> {
  mocks.state.credential = CREDENTIAL;
  return readStdioConfiguration(ENVIRONMENT);
}

async function refresh(
  configuration: PagesConfiguration,
  invalidToken: string,
): Promise<string> {
  if (!configuration.credentials) throw new Error("Expected credentials.");
  return configuration.credentials.refresh(invalidToken);
}

async function rotate(
  configuration: PagesConfiguration,
  currentToken: string,
): Promise<string> {
  if (!configuration.credentials) throw new Error("Expected credentials.");
  return configuration.credentials.rotate(currentToken);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.state.credential = null;
});

describe("readStdioConfiguration with PAGES_TOKEN", () => {
  it("uses the environment credential without the store", async () => {
    const configuration = await readStdioConfiguration({
      ...ENVIRONMENT,
      PAGES_TOKEN: OTHER_TOKEN,
    });
    expect(configuration).toEqual({
      agentsUrl: AGENTS_URL,
      token: OTHER_TOKEN,
    });
    expect(configuration.credentials).toBeUndefined();
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it("validates an empty PAGES_TOKEN instead of reading the store", async () => {
    mocks.state.credential = CREDENTIAL;
    await expect(
      readStdioConfiguration({ ...ENVIRONMENT, PAGES_TOKEN: "" }),
    ).rejects.toThrow(
      "PAGES_TOKEN must be a nonempty Bearer credential without whitespace.",
    );
    expect(mocks.constructed).not.toHaveBeenCalled();
  });
});

describe("readStdioConfiguration with a stored credential", () => {
  it("rejects an invalid instance before opening the store", async () => {
    await expect(
      readStdioConfiguration({ PAGES_URL: "ftp://x" }),
    ).rejects.toThrow("PAGES_URL requires HTTPS");
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it("requires pairing when no credential is stored", async () => {
    await expect(readStdioConfiguration(ENVIRONMENT)).rejects.toThrow(
      new CredentialStoreError(
        "No paired credential. Run pages-mcp pair --url <Pages instance> first.",
      ),
    );
    expect(mocks.constructed).toHaveBeenCalledWith(ENVIRONMENT);
    expect(mocks.get).toHaveBeenCalledWith(INSTANCE);
  });

  it("uses the stored token for the normalized instance", async () => {
    const configuration = await readPairedConfiguration();
    expect(configuration.agentsUrl).toEqual(AGENTS_URL);
    expect(configuration.token).toBe(STORED_TOKEN);
    expect(configuration.credentials).toBeDefined();
    expect(mocks.get).toHaveBeenCalledWith(INSTANCE);
  });
});

describe("stored credential refresh", () => {
  it("adopts a token another process already rotated", async () => {
    const configuration = await readPairedConfiguration();
    mocks.state.credential = { ...CREDENTIAL, token: ROTATED_TOKEN };
    await expect(refresh(configuration, STORED_TOKEN)).resolves.toBe(
      ROTATED_TOKEN,
    );
    expect(configuration.token).toBe(ROTATED_TOKEN);
    expect(mocks.state.credential).toEqual({
      ...CREDENTIAL,
      token: ROTATED_TOKEN,
    });
    expect(mocks.update).toHaveBeenCalledWith(INSTANCE);
  });

  it("removes a credential that is still invalid", async () => {
    const configuration = await readPairedConfiguration();
    await expect(refresh(configuration, STORED_TOKEN)).rejects.toThrow(
      new CredentialStoreError(
        "The paired credential is no longer valid. Run pages-mcp pair --url <Pages instance> again.",
      ),
    );
    expect(mocks.state.credential).toBeNull();
    expect(configuration.token).toBe(STORED_TOKEN);
  });

  it("fails when another process already removed the credential", async () => {
    const configuration = await readPairedConfiguration();
    mocks.state.credential = null;
    await expect(refresh(configuration, STORED_TOKEN)).rejects.toBeInstanceOf(
      CredentialStoreError,
    );
    expect(mocks.state.credential).toBeNull();
  });
});

describe("stored credential rotation", () => {
  it("requires a stored credential", async () => {
    const configuration = await readPairedConfiguration();
    mocks.state.credential = null;
    await expect(rotate(configuration, STORED_TOKEN)).rejects.toThrow(
      new CredentialStoreError(
        "No paired credential. Run pages-mcp pair first.",
      ),
    );
    expect(mocks.postAgentRequest).not.toHaveBeenCalled();
  });

  it("adopts a token another process already rotated", async () => {
    const configuration = await readPairedConfiguration();
    mocks.state.credential = { ...CREDENTIAL, token: OTHER_TOKEN };
    await expect(rotate(configuration, STORED_TOKEN)).resolves.toBe(
      OTHER_TOKEN,
    );
    expect(configuration.token).toBe(OTHER_TOKEN);
    expect(mocks.postAgentRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["an expiry", 1_900_000_000_000],
    ["no expiry", null],
  ])("stores a replacement with %s", async (_, expiresAt) => {
    const configuration = await readPairedConfiguration();
    mocks.postAgentRequest.mockResolvedValue({
      token: ROTATED_TOKEN,
      expiresAt,
    });
    await expect(rotate(configuration, STORED_TOKEN)).resolves.toBe(
      ROTATED_TOKEN,
    );
    expect(mocks.postAgentRequest).toHaveBeenCalledExactlyOnceWith(
      { agentsUrl: AGENTS_URL, token: STORED_TOKEN },
      { operation: "credential.rotate", parameters: {} },
    );
    expect(mocks.state.credential).toEqual({
      ...CREDENTIAL,
      token: ROTATED_TOKEN,
      expiresAt,
    });
    expect(configuration.token).toBe(ROTATED_TOKEN);
  });

  it.each([
    ["null", null],
    ["a string", ROTATED_TOKEN],
    ["an object without token", { expiresAt: null }],
    ["a numeric token", { token: 43, expiresAt: null }],
    ["a short token", { token: "b".repeat(42), expiresAt: null }],
    ["a token with dots", { token: `${"b".repeat(42)}.`, expiresAt: null }],
    ["a missing expiresAt", { token: ROTATED_TOKEN }],
    ["a textual expiresAt", { token: ROTATED_TOKEN, expiresAt: "soon" }],
    ["a fractional expiresAt", { token: ROTATED_TOKEN, expiresAt: 1.5 }],
    ["an unsafe expiresAt", { token: ROTATED_TOKEN, expiresAt: 2 ** 53 }],
  ])("refuses a response with %s", async (_, response) => {
    const configuration = await readPairedConfiguration();
    mocks.postAgentRequest.mockResolvedValue(response);
    await expect(rotate(configuration, STORED_TOKEN)).rejects.toThrow(
      new CredentialStoreError(INVALID_ROTATION),
    );
    expect(mocks.state.credential).toEqual(CREDENTIAL);
    expect(configuration.token).toBe(STORED_TOKEN);
  });
});
