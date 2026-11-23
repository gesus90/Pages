import { beforeEach, expect, it, vi } from "vitest";

import { PICA_CODEX_ADAPTER_VERSION } from "@/backend/agents/acp/PicaCodexAdapterPatch";
import {
  picaCodexBundle,
  selectPicaNativeArtifact,
} from "@/backend/agents/cli/CliPicaSessionSetup";

import type { PicaNativeArtifact } from "@/backend/agents/cli/PicaNativeArtifact";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  picaNativeRunner: vi.fn(),
  preparePicaCodexBundle: vi.fn(),
  requirePicaCodexProfile: vi.fn(),
  requirePicaNativeArtifact: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("@/backend/agents/cli/CliAcpLaunch", () => ({
  picaNativeRunner: mocks.picaNativeRunner,
}));
vi.mock("@/backend/agents/cli/PicaCodexBundle", () => ({
  preparePicaCodexBundle: mocks.preparePicaCodexBundle,
  requirePicaCodexProfile: mocks.requirePicaCodexProfile,
}));
vi.mock("@/backend/agents/cli/PicaNativeArtifact", () => ({
  requirePicaNativeArtifact: mocks.requirePicaNativeArtifact,
}));

/** Builds a deliberately partial test double typed as the parameter it replaces. */
function stub<T>(value: unknown): T {
  return value as T;
}

const codexNative = stub<PicaNativeArtifact>({
  runner: "codex",
  directory: "/native",
});

beforeEach(() => {
  mocks.preparePicaCodexBundle.mockResolvedValue({ bundle: true });
});

it("prepares no bundle for a session without a Codex native artifact", async () => {
  expect(await picaCodexBundle(null, "/dir", { file: "/adapter" })).toBeNull();
  expect(
    await picaCodexBundle(
      stub<PicaNativeArtifact>({ runner: "opencode" }),
      "/dir",
      {
        file: "/adapter",
      },
    ),
  ).toBeNull();
  expect(mocks.preparePicaCodexBundle).not.toHaveBeenCalled();
});

it("uses the adapter file when it has no version or the current one", async () => {
  await picaCodexBundle(codexNative, "/dir", { file: "/adapter" });
  await picaCodexBundle(codexNative, "/dir", {
    file: "/adapter",
    version: PICA_CODEX_ADAPTER_VERSION,
  });
  expect(mocks.preparePicaCodexBundle).toHaveBeenNthCalledWith(
    1,
    "/dir",
    "/adapter",
    "/native",
  );
  expect(mocks.preparePicaCodexBundle).toHaveBeenNthCalledWith(
    2,
    "/dir",
    "/adapter",
    "/native",
  );
});

it("switches to the retained adapter when the version differs", async () => {
  const retained = vi.fn(async () => ({
    file: "/retained",
    version: PICA_CODEX_ADAPTER_VERSION,
  }));
  const bundle = await picaCodexBundle(codexNative, "/dir", {
    file: "/adapter",
    version: "old",
    retained: retained as never,
  });
  expect(bundle).toEqual({ bundle: true });
  expect(mocks.preparePicaCodexBundle).toHaveBeenCalledWith(
    "/dir",
    "/retained",
    "/native",
  );
});

it.each([
  ["no retained function", undefined],
  ["no retained adapter", async () => null],
  [
    "a retained adapter of another version",
    async () => ({
      file: "/r",
      version: "other",
    }),
  ],
])("refuses an outdated adapter with %s", async (description, retained) => {
  await expect(
    picaCodexBundle(codexNative, "/dir", {
      file: "/adapter",
      version: "old",
      retained: retained as never,
    }),
  ).rejects.toMatchObject({ code: "pica_codex_adapter_unavailable" });
  expect(mocks.logCaughtError).toHaveBeenCalledWith(
    "CliPicaSessionSetup",
    expect.anything(),
  );
});

it("maps a synchronous bundle preparation failure to the adapter error", async () => {
  mocks.preparePicaCodexBundle.mockImplementation(() => {
    throw new Error("boom");
  });
  await expect(
    picaCodexBundle(codexNative, "/dir", { file: "/adapter" }),
  ).rejects.toMatchObject({ code: "pica_codex_adapter_unavailable" });
});

function options(
  overrides: Record<string, unknown> = {},
): Parameters<typeof selectPicaNativeArtifact>[0] {
  return stub({
    driver: {
      provider: "codex",
      errors: { adapterUnsupported: "adapter_unsupported" },
    },
    input: { chat: { listener: { picaCodex: true } } },
    launch: { mcpServers: [] },
    profile: { mode: "default" },
    toolsDirectory: "/tools",
    ...overrides,
  });
}

it("selects no native artifact without a chat, runner or in YOLO mode", () => {
  mocks.picaNativeRunner.mockReturnValue("codex");
  expect(selectPicaNativeArtifact(options({ input: {} }))).toBeNull();
  expect(
    selectPicaNativeArtifact(options({ profile: { mode: "yolo" } })),
  ).toBeNull();
  mocks.picaNativeRunner.mockReturnValue(null);
  expect(selectPicaNativeArtifact(options())).toBeNull();
});

it("refuses a chat without the Codex listener or with MCP servers", () => {
  mocks.picaNativeRunner.mockReturnValue("codex");
  expect(() =>
    selectPicaNativeArtifact(options({ input: { chat: { listener: {} } } })),
  ).toThrowError(expect.objectContaining({ code: "adapter_unsupported" }));
  expect(() =>
    selectPicaNativeArtifact(options({ launch: { mcpServers: [{}] } })),
  ).toThrowError(expect.objectContaining({ code: "adapter_unsupported" }));
});

it("requires the Codex profile only for the Codex runner", () => {
  mocks.requirePicaNativeArtifact.mockReturnValue({ artifact: true });
  mocks.picaNativeRunner.mockReturnValue("codex");
  expect(selectPicaNativeArtifact(options())).toEqual({ artifact: true });
  expect(mocks.requirePicaCodexProfile).toHaveBeenCalledTimes(1);
  expect(mocks.requirePicaNativeArtifact).toHaveBeenCalledWith(
    "/tools",
    "codex",
  );
  mocks.picaNativeRunner.mockReturnValue("opencode");
  selectPicaNativeArtifact(options());
  expect(mocks.requirePicaCodexProfile).toHaveBeenCalledTimes(1);
});
