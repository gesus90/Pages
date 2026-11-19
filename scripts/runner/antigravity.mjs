import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import {
  ANTIGRAVITY_APP_DATA_DIRECTORY,
  requireAntigravityContext,
} from "./antigravity-context.mjs";
import { OpenCodeAcpClient, classifyOpenCodeFailure } from "./opencode.mjs";

// The official ACP entry point `agy acp` and its contract, as in
// backend/agents/acp/AntigravityAcpLaunch.ts, which the Pages host applies.
const VERIFIED_VERSION = "1.5.9";
const AGENT_NAME = "Antigravity ACP Server";
// How `agy acp` titles a permission request for a tool of the Pages MCP server.
const PAGES_TOOL_TITLE_PREFIX = "Run mcp_pages_";
// The select option that carries a model's thinking level; the entry point
// refuses `thinking_level` as an unknown option.
const EFFORT_OPTION = "thought_level";
const READ_TOOLS = [
  "view_file",
  "list_directory",
  "search_directory",
  "find_file",
  "search_web",
  "read_url_content",
];

/** Resolves only the dedicated ACP context at this execution host. */
export function antigravityEnvironment(base) {
  if (
    base.PAGES_RUNNER_AGENT_ACCOUNT === "1" ||
    base.PAGES_RUNNER_FULL_ENVIRONMENT === "1"
  )
    return {
      ...base,
      GEMINI_HOME: base.GEMINI_HOME ?? join(base.HOME, ".pages-antigravity"),
      BROWSER: "/bin/true",
    };
  const bound = process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT;
  if (bound) {
    if (
      !isAbsolute(bound) ||
      normalize(bound) !== bound ||
      bound === "/" ||
      bound.endsWith(sep)
    )
      throw new Error("Invalid Antigravity context");
    return {
      ...base,
      HOME: join(bound, "home"),
      GEMINI_HOME: join(bound, "gemini"),
      XDG_CONFIG_HOME: join(bound, "config"),
      XDG_CACHE_HOME: join(bound, "work"),
      BROWSER: "/bin/true",
    };
  }
  const home =
    process.env.PAGES_RUNNER_ANTIGRAVITY_HOME ??
    join(base.HOME, ".pages-antigravity");
  if (!isAbsolute(home) || home.includes("\0"))
    throw new Error("Invalid Antigravity context");
  return { ...base, GEMINI_HOME: home, BROWSER: "/bin/true" };
}

async function requireBoundContext(expected = null) {
  const root = process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT;
  if (!root) return [];
  const uid = process.getuid();
  const identities = [];
  let directory = sep;
  for (const segment of root.split(sep).filter(Boolean)) {
    directory = join(directory, segment);
    const metadata = await lstat(directory);
    const previous = expected?.[identities.length];
    const isPinnedRoot =
      previous?.uid === 0 &&
      metadata.uid === 65534 &&
      previous.dev === metadata.dev &&
      previous.ino === metadata.ino &&
      previous.mode === metadata.mode;
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.uid !== uid && metadata.uid !== 0 && !isPinnedRoot) ||
      (metadata.mode & 0o022) !== 0
    )
      throw new Error("Unmanaged Antigravity context");
    if (expected && !sameHostIdentity(previous, metadata, isPinnedRoot))
      throw new Error("Unmanaged Antigravity context");
    identities.push({
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      mode: metadata.mode,
    });
  }
  for (const child of [
    root,
    ...["home", "gemini", "config", "work"].map((name) => join(root, name)),
  ]) {
    const metadata = await lstat(child);
    const previous = expected?.[identities.length];
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== uid ||
      (metadata.mode & 0o077) !== 0
    )
      throw new Error("Unmanaged Antigravity context");
    if (expected && !sameHostIdentity(previous, metadata, false))
      throw new Error("Unmanaged Antigravity context");
    identities.push({
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      mode: metadata.mode,
    });
  }
  if (expected && expected.length !== identities.length)
    throw new Error("Unmanaged Antigravity context");
  return identities;
}

function sameHostIdentity(previous, metadata, isPinnedRoot) {
  return (
    previous?.dev === metadata.dev &&
    previous.ino === metadata.ino &&
    previous.mode === metadata.mode &&
    (previous.uid === metadata.uid || isPinnedRoot)
  );
}

/** Records trusted host ancestor identities before the worker enters its user namespace. */
export async function antigravityContextProof() {
  return JSON.stringify(await requireBoundContext());
}

async function validateBoundContext() {
  const raw = process.env.PAGES_RUNNER_CONTEXT_PROOF;
  let expected = null;
  if (raw) {
    if (
      raw.length > 8192 ||
      (process.env.PAGES_RUNNER_JOB_NAMESPACE !== "1" &&
        process.env.PAGES_RUNNER_JOB_BOUNDARY !== "worker_unit")
    )
      throw new Error("Invalid Antigravity context proof");
    expected = JSON.parse(raw);
    if (!Array.isArray(expected))
      throw new Error("Invalid Antigravity context proof");
  }
  await requireBoundContext(expected);
}

/** Whether `initialize` came from a stable `agy acp` at or above the verified release. */
function isSupportedAgent(agent) {
  const version = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,9})$/u.exec(
    typeof agent?.version === "string" ? agent.version.trim() : "",
  );
  if (agent?.name !== AGENT_NAME || !version) return false;
  const minimum = VERIFIED_VERSION.split(".").map(Number);
  const parts = version.slice(1).map(Number);
  const index = parts.findIndex((part, position) => part !== minimum[position]);
  return index === -1 || parts[index] > minimum[index];
}

function refuse(options) {
  const option = options.find((entry) => entry.kind === "reject_once");
  return option
    ? { outcome: "selected", optionId: option.optionId }
    : { outcome: "cancelled" };
}

// In `default` mode `agy acp` asks before every call of an MCP tool, the
// step's own Pages tools included. A read-only job approves only those; its
// native tools are limited to the reading allowlist, so nothing else exists.
function isPagesToolCall(toolCall) {
  return (
    (toolCall?.kind ?? "other") === "other" &&
    typeof toolCall?.title === "string" &&
    toolCall.title.startsWith(PAGES_TOOL_TITLE_PREFIX)
  );
}

function decide(options, access, toolCall) {
  if (access !== "yolo" && !isPagesToolCall(toolCall)) return refuse(options);
  const option = options.find((entry) => entry.kind === "allow_once");
  return option
    ? { outcome: "selected", optionId: option.optionId }
    : refuse(options);
}

async function publish(event) {
  if (!process.stdout.write(`${JSON.stringify(event)}\n`))
    await once(process.stdout, "drain");
}

function start(environment, directory, options = {}) {
  const child = spawn(
    "agy",
    [
      "acp",
      `--gemini-dir=${environment.GEMINI_HOME}`,
      `--app-data-dir=${ANTIGRAVITY_APP_DATA_DIRECTORY}`,
      "--disable-telemetry",
    ],
    {
      cwd: directory,
      // A managed generation never replaces itself; updates go through the tool manager.
      env: { ...environment, AGY_CLI_DISABLE_AUTO_UPDATE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.on("error", () => child.kill("SIGKILL"));
  // Inventory and execution never start a new login or wait for a browser.
  let tail = "";
  let requiresLogin = false;
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    tail = (tail + chunk).slice(-16384);
    if (
      tail.includes("Open the following link to authenticate") ||
      /https:\/\/accounts\.google\.com\/o\/oauth2\//u.test(tail)
    ) {
      requiresLogin = true;
      child.kill("SIGKILL");
    }
  });
  return {
    child,
    get requiresLogin() {
      return requiresLogin;
    },
    client: new OpenCodeAcpClient(
      child,
      (choices, toolCall) => decide(choices, options.access, toolCall),
      options.publish,
    ),
  };
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.stdin.end();
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await closed;
  } finally {
    clearTimeout(timeout);
  }
}

function choices(options, id) {
  const option = options?.find(
    (entry) => entry.id === id && entry.type === "select",
  );
  return (
    option?.options?.flatMap((entry) =>
      entry.group ? entry.options : [entry],
    ) ?? []
  );
}

async function initialize(client) {
  const response = await client.call("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "pages", version: "1.14.0" },
  });
  if (
    response.protocolVersion !== 1 ||
    !isSupportedAgent(response.agentInfo) ||
    !response.authMethods?.some((method) => method.id === "oauth-personal")
  )
    throw Object.assign(new Error("Adapter incompatible"), {
      pagesCode: "antigravity_acp_unsupported",
    });
  return response;
}

/** Requires membership and exact echo, including when the adapter would remap thinking levels. */
export async function chooseAntigravity(client, sessionId, options, selection) {
  const { id, value, error } = selection;
  if (!choices(options, id).some((entry) => entry.value === value))
    throw Object.assign(new Error("Selection unavailable"), {
      pagesCode: error,
    });
  const response = await client.call("session/set_config_option", {
    sessionId,
    configId: id,
    value,
  });
  if (
    response.configOptions?.find((entry) => entry.id === id)?.currentValue !==
    value
  )
    throw Object.assign(new Error("Selection not confirmed"), {
      pagesCode: error,
    });
  return response.configOptions;
}

/** Probes the official ACP identity, actual auth context and per-model selectors without a prompt. */
export async function antigravityInventory(base, context = {}) {
  const environment = antigravityEnvironment(base);
  if (base.PAGES_RUNNER_AGENT_ACCOUNT !== "1") await validateBoundContext();
  const entry = {
    tool: "antigravity",
    version: null,
    authentication: "unknown",
    models: [],
    acp: { status: "incompatible", reason: "probe_failed" },
  };
  const running = start(environment, base.HOME);
  const { child, client } = running;
  const cancel = () => child.kill("SIGKILL");
  const timer = setTimeout(cancel, 30000);
  context.signal?.addEventListener("abort", cancel, { once: true });
  if (context.signal?.aborted) cancel();
  try {
    const response = await initialize(client);
    entry.version = response.agentInfo.version;
    // Pages accepts every stable `agy acp` from the verified release on.
    entry.acp = {
      status: "verified",
      reason:
        entry.version === VERIFIED_VERSION
          ? "exact_version"
          : "contract_matches",
    };
    await requireAntigravityContext(environment, base.HOME);
    const session = await client.call("session/new", {
      cwd: base.HOME,
      mcpServers: [],
      _meta: { antigravity: { enabledTools: [] } },
    });
    const models = choices(session.configOptions, "model");
    if (
      !models.length ||
      models.length > 1000 ||
      !choices(session.configOptions, "mode").length
    )
      throw new Error("Selectors unavailable");
    for (const model of models) {
      try {
        const selected = await chooseAntigravity(
          client,
          session.sessionId,
          session.configOptions,
          { id: "model", value: model.value, error: "plan_model_unavailable" },
        );
        entry.models.push({
          id: model.value,
          name: model.name,
          reasoningEfforts: choices(selected, EFFORT_OPTION).map(
            (effort) => effort.value,
          ),
        });
      } catch (error) {
        if (
          error.pagesCode !== "plan_model_unavailable" &&
          error.acpCode === undefined
        )
          throw error;
      }
    }
    if (entry.models.length === 0)
      throw Object.assign(new Error("Models unavailable"), {
        pagesCode: "plan_model_unavailable",
      });
    entry.authentication = "authenticated";
  } catch (error) {
    entry.models = [];
    if (
      running.requiresLogin ||
      error.pagesCode === "provider_auth_failed" ||
      error.acpCode === -32000
    )
      entry.authentication = "not_logged_in";
    context.onError?.(error);
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", cancel);
    await stop(child);
  }
  entry.catalogRevision = createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
  return entry;
}

// The adapter 1.4.4 reports its own failures as agent text and still ends the
// turn with `end_turn`. These fixed wordings mirror
// backend/agents/acp/AntigravityTurnFailure.ts, which the Pages host applies.
const ADAPTER_REPORTS = [
  [
    "provider_quota_exhausted",
    /(?:^|\n)Usage Limit Reached\n\nYou have reached your current quota for this period\./u,
  ],
  [
    "plan_mcp_unavailable",
    /(?:^|\n)The MCP server '[\w-]+' failed to initialize[:.]/u,
  ],
  ["antigravity_acp_session_failed", /(?:^|\n)Agent execution error: /u],
  [
    "antigravity_acp_session_failed",
    /(?:^|\n)Agent connection was lost and could not be re-established: /u,
  ],
];

/** The error code of an adapter-reported failure in the final message, or `null`. */
export function antigravityTurnFailure(text, hasMcp) {
  const report = ADAPTER_REPORTS.find(
    ([code, pattern]) =>
      pattern.test(text) && (code !== "plan_mcp_unavailable" || hasMcp),
  );
  return report ? report[0] : null;
}

/** Executes one frozen remote assignment through the same bounded ACP transport as OpenCode. */
export async function executeAntigravity(job, prompt, base = process.env) {
  const environment = antigravityEnvironment(base);
  if (base.PAGES_RUNNER_AGENT_ACCOUNT !== "1") await validateBoundContext();
  await requireAntigravityContext(environment, job.workspace);
  if (!["read_only", "yolo"].includes(job.access))
    throw new Error("Invalid Antigravity mode");
  const { child, client } = start(environment, job.workspace, {
    access: job.access,
    publish,
  });
  try {
    const initialized = await initialize(client);
    const canResume =
      initialized.agentCapabilities?.sessionCapabilities?.resume !== undefined;
    if (job.resumeSessionId && !canResume)
      throw Object.assign(new Error("Resume unsupported"), {
        pagesCode: "acp_session_resume_failed",
      });
    let session;
    try {
      session = await client.call(
        job.resumeSessionId ? "session/resume" : "session/new",
        {
          ...(job.resumeSessionId ? { sessionId: job.resumeSessionId } : {}),
          cwd: job.workspace,
          mcpServers: job.mcpServers,
          _meta: {
            antigravity: {
              ...enabledTools(job),
              eagerMcpServers: ["pages"],
            },
          },
        },
      );
    } catch (error) {
      if (job.resumeSessionId)
        throw Object.assign(error, { pagesCode: "acp_session_resume_failed" });
      throw error;
    }
    if (job.resumeSessionId) {
      if (session.sessionId && session.sessionId !== job.resumeSessionId)
        throw Object.assign(new Error("Session changed"), {
          pagesCode: "acp_session_resume_failed",
        });
      session = { ...session, sessionId: job.resumeSessionId };
    }
    await publish({
      type: "pages.session",
      sessionId: session.sessionId,
      canResume,
    });
    let options = await chooseAntigravity(
      client,
      session.sessionId,
      session.configOptions,
      { id: "model", value: job.model, error: "plan_model_unavailable" },
    );
    if (job.reasoningEffort !== null)
      options = await chooseAntigravity(client, session.sessionId, options, {
        id: EFFORT_OPTION,
        value: job.reasoningEffort,
        error: "plan_reasoning_unsupported",
      });
    // `agy acp` refuses `yolo` as an unknown mode. A YOLO job runs in
    // `default`, and `decide` approves every permission request.
    options = await chooseAntigravity(client, session.sessionId, options, {
      id: "mode",
      value: "default",
      error: "antigravity_acp_unsupported",
    });
    if (
      options.find((entry) => entry.id === "model")?.currentValue !==
        job.model ||
      (job.reasoningEffort !== null &&
        options.find((entry) => entry.id === EFFORT_OPTION)?.currentValue !==
          job.reasoningEffort)
    )
      throw Object.assign(new Error("Configuration changed before prompt"), {
        pagesCode: "plan_context_changed",
      });
    await publish({
      type: "pages.configuration",
      model: options.find((entry) => entry.id === "model")?.currentValue,
      reasoningEffort: options.find((entry) => entry.id === EFFORT_OPTION)
        ?.currentValue,
    });
    const turn = await client.call("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    await client.flushMessage();
    const failure = antigravityTurnFailure(
      client.text,
      Array.isArray(job.mcpServers) && job.mcpServers.length > 0,
    );
    if (failure && turn.stopReason === "end_turn")
      return {
        type: "pages.result",
        error: failure,
        stopReason: turn.stopReason,
      };
    return turn.stopReason === "end_turn" && client.text.trim()
      ? {
          type: "pages.result",
          sessionId: session.sessionId,
          stopReason: turn.stopReason,
          answer: client.text,
          usage: turn.usage ?? null,
        }
      : {
          type: "pages.result",
          error: "antigravity_acp_session_failed",
          stopReason: turn.stopReason,
        };
  } finally {
    await stop(child);
  }
}

function enabledTools(job) {
  if (job.purpose) return { enabledTools: [] };
  if (job.access === "read_only") return { enabledTools: READ_TOOLS };
  return {};
}

async function main() {
  const job = JSON.parse(process.env.PAGES_ANTIGRAVITY_JOB ?? "{}");
  delete process.env.PAGES_ANTIGRAVITY_JOB;
  let input = "";
  let result;
  try {
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 1048576)
        throw new Error("Prompt exceeds limit");
    }
    result = await executeAntigravity(job, input);
  } catch (error) {
    const classified = classifyOpenCodeFailure(error.acpText ?? "");
    result = {
      type: "pages.result",
      error:
        error.pagesCode ??
        (classified === "opencode_acp_session_failed"
          ? "antigravity_acp_session_failed"
          : classified),
    };
  }
  await publish(result);
  process.exitCode = result.answer ? 0 : 1;
}

/** The entry point installed beside the runner; no updater or shell wrapper. */
export function antigravityCommand() {
  return [fileURLToPath(import.meta.url), "--acp"];
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === "--acp"
)
  await main();
