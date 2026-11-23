import { describe, expect, it, vi } from "vitest";

import type * as NodeCrypto from "node:crypto";

import {
  PICA_CODEX_ADAPTER_VERSION,
  patchPicaCodexAdapter,
} from "@/backend/agents/acp/PicaCodexAdapterPatch";

const pinned = vi.hoisted(() => ({ trusted: true }));

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof NodeCrypto>();
  return {
    ...original,
    createHash: (algorithm: string) => {
      const hash = original.createHash(algorithm);
      if (!pinned.trusted) return hash;
      return {
        update: () => ({
          digest: () =>
            "6b1bb4e7e9caaf4aeca1042ae4aec2dc2433b0b0e4b1614b38a4d41699902aaa",
        }),
      };
    },
  };
});

const SESSION_START = `    const sessionConfig = await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers);
    const response = await this.codexClient.threadStart({
      config: sessionConfig.config,
      modelProvider: this.getModelProvider(),
      cwd: request.cwd,
      ...developerInstructions !== void 0 && { developerInstructions }
    });
    const codexModels = await this.fetchAvailableModels();`;

const CLIENT_CONSTRUCTOR = `  connectionLoss;
  constructor(connection) {
    this.connection = connection;
    this.connectionLoss = new ConnectionLoss(connection);`;

const RUN_TURN = `  async runTurn(params, onTurnStarted) {
    const capturedCompletions = [];
    const releaseCapture = this.captureTurnCompletions(params.threadId, (event) => {
      capturedCompletions.push(event);
    });
    try {
      const turnStarted = await this.turnStart(params);
      onTurnStarted?.(turnStarted.turn.id);
      const earlyCompletion = capturedCompletions.find((event) => event.turn.id === turnStarted.turn.id);
      releaseCapture();
      if (earlyCompletion) {
        return earlyCompletion;
      }
      return await this.awaitTurnCompleted(params.threadId, turnStarted.turn.id);
    } finally {
      releaseCapture();
    }
  }`;

const DYNAMIC_REPORTER = `var DynamicToolReporter = class {
  static started(item) {
    return {
      toolCallId: item.id,
      report: "start",
      name: functionToolName(item.tool, item.namespace),
      kind: "execute",
      title: item.tool,
      status: toToolStatus(item.status),
      input: { arguments: item.arguments },
      ...resultFacts(item)
    };
  }
  static completed(item) {
    return {
      toolCallId: item.id,
      report: "update",
      name: functionToolName(item.tool, item.namespace),
      status: toTerminalToolStatus(item.status),
      ...resultFacts(item)
    };
  }
};`;

const CREATE_AGENT = `  function createAgent(connection) {\n    const appServerClient = new CodexAppServerClient(codexProcessState.connection.connection);`;
const CLOSE_SESSION = `  async closeSession(sessionId) {\n    try {\n      await this.codexClient.threadUnsubscribe({ threadId: sessionId });`;
const THREAD_RESUME = `  async threadResume(params) {\n    return await this.sendRequest({ method: "thread/resume", params });\n  }`;
const THREAD_FORK = `  async threadFork(params) {\n    return await this.sendRequest({ method: "thread/fork", params });\n  }`;
const LOG_DIR = `    const logDir = process.env["APP_SERVER_LOGS"];`;
const LOGGER = `var logger = new Logger();`;
const MODULE_URLS = Array.from({ length: 5 }, () => "import.meta.url");

const SEGMENTS = [
  SESSION_START,
  CLIENT_CONSTRUCTOR,
  RUN_TURN,
  DYNAMIC_REPORTER,
  CREATE_AGENT,
  CLOSE_SESSION,
  THREAD_RESUME,
  THREAD_FORK,
  LOG_DIR,
  LOGGER,
  ...MODULE_URLS,
];

const BUNDLE = `#!/usr/bin/env node\n${SEGMENTS.join("\n")}\n`;

const PACKAGE_JSON = JSON.stringify({
  name: "@agentclientprotocol/codex-acp",
  version: PICA_CODEX_ADAPTER_VERSION,
  license: "Apache-2.0",
});

const GLUE = {
  path: "/srv/pages/glue.mjs",
  sha256: "a".repeat(64),
  upstreamBundlePath: "/srv/codex/dist/index.js",
};

describe("patchPicaCodexAdapter", () => {
  it("rewrites every supported marker and prepends the bootstrap", () => {
    pinned.trusted = true;
    const patched = patchPicaCodexAdapter(BUNDLE, PACKAGE_JSON, GLUE);
    expect(patched.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(patched).toContain(JSON.stringify(GLUE.path));
    expect(patched).toContain(JSON.stringify(GLUE.sha256));
    expect(patched).toContain("pagesCatalog()");
    expect(patched).toContain("pagesPrepareTurn");
    expect(patched).toContain("pagesAttachClient(connection)");
    expect(patched).toContain("pagesCloseThread(sessionId)");
    expect(patched).toContain("Pica thread resume unavailable");
    expect(patched).toContain("Pica thread fork unavailable");
    expect(patched).toContain("const logDir = undefined;");
    expect(patched).toContain("logger.log = () => {};");
    expect(patched).not.toContain("import.meta.url");
    expect(patched).toContain("file:///srv/codex/dist/index.js");
  });

  it.each([
    "null",
    "[]",
    JSON.stringify({ name: "x", version: "2.2.2", license: "Apache-2.0" }),
    JSON.stringify({ name: "@agentclientprotocol/codex-acp", version: "1" }),
    JSON.stringify({
      name: "@agentclientprotocol/codex-acp",
      version: "2.2.2",
      license: "MIT",
    }),
  ])("refuses the package metadata %s", (packageJson) => {
    expect(() => patchPicaCodexAdapter(BUNDLE, packageJson, GLUE)).toThrow(
      "Unsupported Codex adapter package",
    );
  });

  it.each([
    { ...GLUE, path: "relative.mjs" },
    { ...GLUE, path: "/srv/../glue.mjs" },
    { ...GLUE, upstreamBundlePath: "relative.js" },
    { ...GLUE, upstreamBundlePath: "/srv/./index.js" },
    { ...GLUE, sha256: "xyz" },
  ])("refuses the glue source %j", (glue) => {
    expect(() => patchPicaCodexAdapter(BUNDLE, PACKAGE_JSON, glue)).toThrow(
      "Invalid Pica adapter glue source",
    );
  });

  it("refuses a bundle other than the pinned one", () => {
    pinned.trusted = false;
    expect(() => patchPicaCodexAdapter(BUNDLE, PACKAGE_JSON, GLUE)).toThrow(
      "Unsupported Codex adapter bundle",
    );
    pinned.trusted = true;
  });

  it("refuses a bundle with a missing or repeated marker", () => {
    pinned.trusted = true;
    expect(() =>
      patchPicaCodexAdapter(`${BUNDLE}${LOGGER}`, PACKAGE_JSON, GLUE),
    ).toThrow("Unsupported Codex adapter source marker");
    expect(() =>
      patchPicaCodexAdapter("#!/usr/bin/env node\n", PACKAGE_JSON, GLUE),
    ).toThrow("Unsupported Codex adapter source marker");
  });

  it("refuses a bundle with an unexpected number of module urls", () => {
    pinned.trusted = true;
    expect(() =>
      patchPicaCodexAdapter(`${BUNDLE}import.meta.url`, PACKAGE_JSON, GLUE),
    ).toThrow("Unsupported Codex adapter module resolution");
  });
});
