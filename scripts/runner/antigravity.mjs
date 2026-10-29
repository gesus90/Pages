import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { OpenCodeAcpClient, classifyOpenCodeFailure } from "./opencode.mjs";

const VERSION = "1.4.4";
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
    if (raw.length > 8192 || process.env.PAGES_RUNNER_JOB_NAMESPACE !== "1")
      throw new Error("Invalid Antigravity context proof");
    expected = JSON.parse(raw);
    if (!Array.isArray(expected))
      throw new Error("Invalid Antigravity context proof");
  }
  await requireBoundContext(expected);
}

async function contextMetadata(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw Object.assign(new Error("Unmanaged configuration"), {
      pagesCode: "antigravity_configuration_unmanaged",
    });
  }
}

async function requireContext(environment, workspace) {
  const root = environment.GEMINI_HOME;
  const directory = await contextMetadata(join(root, "antigravity-acp"));
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
    throw Object.assign(new Error("Unmanaged configuration"), {
      pagesCode: "antigravity_configuration_unmanaged",
    });
  const token = await lstat(join(root, "antigravity-acp/acp_token.json")).catch(
    () => null,
  );
  if (!token?.isFile() || token.isSymbolicLink())
    throw Object.assign(new Error("Login required"), {
      pagesCode: "provider_auth_failed",
    });
  for (const name of [
    "config",
    "antigravity-cli",
    "antigravity-acp/hooks.json",
    "antigravity-acp/mcp_config.json",
  ]) {
    if (await contextMetadata(join(root, name)))
      throw Object.assign(new Error("Unmanaged configuration"), {
        pagesCode: "antigravity_configuration_unmanaged",
      });
  }
  if (workspace)
    for (const folder of [".agents", ".agent", "_agents", "_agent"])
      if (await contextMetadata(join(workspace, folder, "hooks.json")))
        throw Object.assign(new Error("Unmanaged workspace hooks"), {
          pagesCode: "antigravity_configuration_unmanaged",
        });
  const file = join(root, "antigravity-acp/settings.json");
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096)
    throw new Error("Invalid Antigravity settings");
  const settings = JSON.parse(await readFile(file, "utf8"));
  if (
    Object.keys(settings).length !== 1 ||
    Object.keys(settings.auth ?? {}).length !== 1 ||
    settings.auth.type !== "oauth-personal"
  )
    throw new Error("Invalid Antigravity settings");
}

function refuse(options) {
  const option = options.find((entry) => entry.kind === "reject_once");
  return option
    ? { outcome: "selected", optionId: option.optionId }
    : { outcome: "cancelled" };
}

function decide(options, access) {
  if (access !== "yolo") return refuse(options);
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
  const child = spawn("agy_acp_server.par", ["--uid="], {
    cwd: directory,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => child.kill("SIGKILL"));
  // Inventory and execution never start a new login or wait for a browser.
  let tail = "";
  let requiresLogin = false;
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    tail = (tail + chunk).slice(-16384);
    if (tail.includes("Open the following link to authenticate")) {
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
      (choices) => decide(choices, options.access),
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
    response.agentInfo?.name !== "antigravity-acp" ||
    response.agentInfo.version !== VERSION ||
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
  await validateBoundContext();
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
    entry.acp = { status: "verified", reason: "exact_version" };
    await requireContext(environment, base.HOME);
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
      const selected = await chooseAntigravity(
        client,
        session.sessionId,
        session.configOptions,
        { id: "model", value: model.value, error: "plan_model_unavailable" },
      );
      entry.models.push({
        id: model.value,
        name: model.name,
        reasoningEfforts: choices(selected, "thinking_level").map(
          (effort) => effort.value,
        ),
      });
    }
    entry.authentication = "authenticated";
  } catch (error) {
    entry.models = [];
    if (
      running.requiresLogin ||
      error.pagesCode === "provider_auth_failed" ||
      error.acpCode === -32000
    )
      entry.authentication = "not_logged_in";
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
  await validateBoundContext();
  await requireContext(environment, job.workspace);
  if (!["read_only", "yolo"].includes(job.access))
    throw new Error("Invalid Antigravity mode");
  const { child, client } = start(environment, job.workspace, {
    access: job.access,
    publish,
  });
  try {
    await initialize(client);
    const session = await client.call("session/new", {
      cwd: job.workspace,
      mcpServers: job.mcpServers,
      _meta: {
        antigravity: {
          ...(job.access === "read_only" ? { enabledTools: READ_TOOLS } : {}),
          eagerMcpServers: ["pages"],
        },
      },
    });
    let options = await chooseAntigravity(
      client,
      session.sessionId,
      session.configOptions,
      { id: "model", value: job.model, error: "plan_model_unavailable" },
    );
    if (job.reasoningEffort !== null)
      options = await chooseAntigravity(client, session.sessionId, options, {
        id: "thinking_level",
        value: job.reasoningEffort,
        error: "plan_reasoning_unsupported",
      });
    options = await chooseAntigravity(client, session.sessionId, options, {
      id: "mode",
      value: job.access === "yolo" ? "yolo" : "default",
      error: "antigravity_acp_unsupported",
    });
    if (
      options.find((entry) => entry.id === "model")?.currentValue !==
        job.model ||
      (job.reasoningEffort !== null &&
        options.find((entry) => entry.id === "thinking_level")?.currentValue !==
          job.reasoningEffort)
    )
      throw Object.assign(new Error("Configuration changed before prompt"), {
        pagesCode: "plan_context_changed",
      });
    await publish({
      type: "pages.configuration",
      model: options.find((entry) => entry.id === "model")?.currentValue,
      reasoningEffort: options.find((entry) => entry.id === "thinking_level")
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
