import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PICA_CODEX_INJECTED } from "./PicaCodexInjected";

/** Immutable Pages-owned glue module selected by the future chat launcher. */
export interface PicaCodexGlueSource {
  readonly path: string;
  readonly sha256: string;
  /** Original pinned adapter path used for its bundled module resolution. */
  readonly upstreamBundlePath: string;
}

const PACKAGE_NAME = "@agentclientprotocol/codex-acp";
const PACKAGE_VERSION = "2.2.2";
const BUNDLE_SHA256 =
  "6b1bb4e7e9caaf4aeca1042ae4aec2dc2433b0b0e4b1614b38a4d41699902aaa";

const SESSION_START = `    const sessionConfig = await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers);
    const response = await this.codexClient.threadStart({
      config: sessionConfig.config,
      modelProvider: this.getModelProvider(),
      cwd: request.cwd,
      ...developerInstructions !== void 0 && { developerInstructions }
    });
    const codexModels = await this.fetchAvailableModels();`;

const SESSION_START_PATCH = `    const sessionConfig = await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers);
    const pagesTools = await pagesCatalog();
    const pagesPolicy = await pagesCreatePolicy(pagesTools);
    const response = await this.codexClient.threadStart({
      config: sessionConfig.config,
      modelProvider: this.getModelProvider(),
      cwd: request.cwd,
      dynamicTools: pagesTools,
      picaPolicy: pagesPolicy,
      ...developerInstructions !== void 0 && { developerInstructions }
    });
    pagesVerifyPolicy(response, pagesPolicy);
    await pagesBindThread(response.thread.id, pagesTools, pagesPolicy.context);
    const codexModels = await this.fetchAvailableModels();`;

const CLIENT_CONSTRUCTOR = `  connectionLoss;
  constructor(connection) {
    this.connection = connection;
    this.connectionLoss = new ConnectionLoss(connection);`;

const CLIENT_CONSTRUCTOR_PATCH = `${CLIENT_CONSTRUCTOR}
    this.connectionLoss.onLost(pagesConnectionLost);
    this.connection.onRequest(new import_node2.RequestType("item/tool/call"), pagesCall);
    this.connection.onRequest(new import_node2.RequestType("pages/pica/registryReady"), pagesRegistryReady);
    this.connection.onRequest(new import_node2.RequestType("pages/pica/registryRevoked"), pagesRegistryRevoked);
    this.connection.onRequest(new import_node2.RequestType("pages/pica/threadInvalidated"), pagesThreadInvalidated);`;

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

const RUN_TURN_PATCH = `  async runTurn(params, onTurnStarted) {
    const capturedCompletions = [];
    const releaseCapture = this.captureTurnCompletions(params.threadId, (event) => {
      capturedCompletions.push(event);
    });
    let pagesTurnId = null;
    let pagesPending = null;
    try {
      pagesPending = await pagesPrepareTurn(params.threadId);
      const turnStarted = await this.turnStart({ ...params, picaOperation: pagesNativeOperation(params.threadId, pagesPending) });
      await pagesAwaitTurn(params.threadId, pagesPending, turnStarted.turn.id);
      pagesTurnId = turnStarted.turn.id;
      onTurnStarted?.(turnStarted.turn.id);
      const earlyCompletion = capturedCompletions.find((event) => event.turn.id === turnStarted.turn.id);
      releaseCapture();
      if (earlyCompletion) {
        return earlyCompletion;
      }
      return await this.awaitTurnCompleted(params.threadId, turnStarted.turn.id);
    } finally {
      releaseCapture();
      try {
        if (pagesTurnId !== null) await pagesEndTurn(params.threadId, pagesTurnId);
        else if (pagesPending !== null) await pagesCancelPending(params.threadId, pagesPending);
      } finally {
        if (pagesConnectionSettlement) await pagesConnectionSettlement;
      }
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

const DYNAMIC_REPORTER_PATCH = `var DynamicToolReporter = class {
  static started(item) {
    return { toolCallId: item.id, report: "start", name: functionToolName(item.tool, item.namespace), kind: "execute", title: item.tool, status: toToolStatus(item.status) };
  }
  static completed(item) {
    return { toolCallId: item.id, report: "update", name: functionToolName(item.tool, item.namespace), status: toTerminalToolStatus(item.status) };
  }
};`;

function replaceOnce(
  source: string,
  marker: string,
  replacement: string,
): string {
  const position = source.indexOf(marker);
  if (position < 0 || position !== source.lastIndexOf(marker))
    throw new Error("Unsupported Codex adapter source marker");
  return (
    source.slice(0, position) +
    replacement +
    source.slice(position + marker.length)
  );
}

function requireVersion(packageJson: string): void {
  const metadata: unknown = JSON.parse(packageJson);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Reflect.get(metadata, "name") !== PACKAGE_NAME ||
    Reflect.get(metadata, "version") !== PACKAGE_VERSION ||
    Reflect.get(metadata, "license") !== "Apache-2.0"
  )
    throw new Error("Unsupported Codex adapter package");
}

function requireGlue(glue: PicaCodexGlueSource): void {
  if (
    !path.isAbsolute(glue.path) ||
    path.normalize(glue.path) !== glue.path ||
    !path.isAbsolute(glue.upstreamBundlePath) ||
    path.normalize(glue.upstreamBundlePath) !== glue.upstreamBundlePath ||
    !/^[a-f0-9]{64}$/u.test(glue.sha256)
  )
    throw new Error("Invalid Pica adapter glue source");
}

function bootstrap(glue: PicaCodexGlueSource): string {
  return (
    `\n// Pica-specific modification of codex-acp 2.2.2; Apache-2.0, Copyright 2025 JetBrains s.r.o.\n` +
    `// The original package LICENSE must accompany any redistributed adapter bundle.\n` +
    `import { open as pagesOpen } from "node:fs/promises";\n` +
    `import { constants as pagesFsConstants } from "node:fs";\n` +
    `import { createHash as pagesHash } from "node:crypto";\n` +
    `const pagesGluePath = ${JSON.stringify(glue.path)};\n` +
    `const pagesGlueDigest = ${JSON.stringify(glue.sha256)};\n` +
    PICA_CODEX_INJECTED
  );
}

/**
 * Produces a Pica-only adapter bundle from the exact supported upstream bytes.
 *
 * @remarks
 * The caller must supply trusted package metadata and a server-owned glue path
 * and digest. The generated bundle verifies the actual glue bytes before import.
 * It refuses resume and fork until catalog persistence can be established.
 * The adapter is Apache-2.0, Copyright 2025 JetBrains s.r.o.; redistribution
 * of a generated bundle must include the original package LICENSE.
 */
export function patchPicaCodexAdapter(
  bundle: string,
  packageJson: string,
  glue: PicaCodexGlueSource,
): string {
  requireVersion(packageJson);
  requireGlue(glue);
  if (
    createHash("sha256").update(bundle, "utf8").digest("hex") !== BUNDLE_SHA256
  )
    throw new Error("Unsupported Codex adapter bundle");
  let source = replaceOnce(bundle, SESSION_START, SESSION_START_PATCH);
  source = replaceOnce(source, CLIENT_CONSTRUCTOR, CLIENT_CONSTRUCTOR_PATCH);
  source = replaceOnce(source, RUN_TURN, RUN_TURN_PATCH);
  source = replaceOnce(source, DYNAMIC_REPORTER, DYNAMIC_REPORTER_PATCH);
  source = replaceOnce(
    source,
    `  function createAgent(connection) {\n    const appServerClient = new CodexAppServerClient(codexProcessState.connection.connection);`,
    `  function createAgent(connection) {\n    pagesAttachClient(connection);\n    const appServerClient = new CodexAppServerClient(codexProcessState.connection.connection);`,
  );
  source = replaceOnce(
    source,
    `  async closeSession(sessionId) {\n    try {\n      await this.codexClient.threadUnsubscribe({ threadId: sessionId });`,
    `  async closeSession(sessionId) {\n    try {\n      try {\n        await pagesCloseThread(sessionId);\n      } finally {\n        await this.codexClient.threadUnsubscribe({ threadId: sessionId });\n      }`,
  );
  source = replaceOnce(
    source,
    `  async threadResume(params) {\n    return await this.sendRequest({ method: "thread/resume", params });\n  }`,
    `  async threadResume(params) {\n    throw new Error("Pica thread resume unavailable");\n  }`,
  );
  source = replaceOnce(
    source,
    `  async threadFork(params) {\n    return await this.sendRequest({ method: "thread/fork", params });\n  }`,
    `  async threadFork(params) {\n    throw new Error("Pica thread fork unavailable");\n  }`,
  );
  source = replaceOnce(
    source,
    `    const logDir = process.env["APP_SERVER_LOGS"];`,
    `    const logDir = undefined;`,
  );
  source = replaceOnce(
    source,
    `var logger = new Logger();`,
    `var logger = new Logger();\nlogger.log = () => {};\nlogger.error = () => {};`,
  );
  if (source.split("import.meta.url").length !== 6)
    throw new Error("Unsupported Codex adapter module resolution");
  source = source.replaceAll(
    "import.meta.url",
    JSON.stringify(pathToFileURL(glue.upstreamBundlePath).href),
  );
  return replaceOnce(
    source,
    "#!/usr/bin/env node\n",
    `#!/usr/bin/env node\n${bootstrap(glue)}\n`,
  );
}
