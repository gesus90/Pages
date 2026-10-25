// OpenCode on the runner host (PAGE-154): inventory, ACP contract check and ACP execution.
// The host's own OpenCode configuration and keys are used; Pages sends none.
import { spawn, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The OpenCode release whose ACP contract Pages verified. */
export const VERIFIED_OPENCODE_VERSION = "1.18.34";
const MODALITIES = ["text", "image", "video", "audio", "pdf"];
const ENTRY = /^(\S+)\n(\{\n[\s\S]*?\n\})$/gmu;
const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const MODEL_ID = /^[a-zA-Z0-9/~_.:+-]{1,200}$/;
const EFFORT = /^[a-z][a-z0-9_-]{0,23}$/;
const SAFE_SETTINGS = { share: "disabled", autoupdate: false };

/** OpenCode never updates itself or shares a session when the runner starts it. */
export function openCodeEnvironment(base, configuration = SAFE_SETTINGS) {
  return {
    ...base,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(configuration),
  };
}

function run(environment, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      "opencode",
      args,
      {
        env: environment,
        signal: options.signal,
        timeout: options.timeout ?? 15000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) =>
        resolve({ ok: !error, missing: error?.code === "ENOENT", stdout }),
    );
  });
}

function statedOutputs(capabilities) {
  const output = capabilities?.output;
  if (typeof output !== "object" || output === null) return undefined;
  return MODALITIES.filter((modality) => output[modality] === true);
}

/** Keeps OpenCode's own statements; Pages applies its global model filter to them. */
function listedModel(id, entry) {
  const name =
    typeof entry.name === "string" && /^[^\p{Cc}]{1,200}$/u.test(entry.name)
      ? entry.name
      : id;
  const efforts = Object.keys(entry.variants ?? {}).filter((effort) =>
    EFFORT.test(effort),
  );
  const outputs = statedOutputs(entry.capabilities);
  return {
    id,
    name,
    reasoningEfforts: efforts.slice(0, 10),
    ...(typeof entry.status === "string" && entry.status.length <= 40
      ? { status: entry.status }
      : {}),
    ...(outputs ? { outputs } : {}),
    ...(typeof entry.capabilities?.toolcall === "boolean"
      ? { toolCall: entry.capabilities.toolcall }
      : {}),
    isFree: entry.cost?.input === 0 && entry.cost?.output === 0,
  };
}

/** Reads `opencode models --verbose`: an ID line followed by its pretty-printed JSON. */
export function readOpenCodeListing(stdout) {
  const models = [];
  for (const match of stdout.matchAll(ENTRY)) {
    if (!MODEL_ID.test(match[1]) || !PROVIDER.test(match[1].split("/")[0]))
      continue;
    try {
      models.push(listedModel(match[1], JSON.parse(match[2])));
    } catch {
      continue;
    }
    if (models.length >= 1000) break;
  }
  return models;
}

/** A minimal ACP client over the child's standard streams; requests the agent sends get safe answers. */
class AcpClient {
  constructor(child, decide) {
    this.child = child;
    this.decide = decide;
    this.pending = new Map();
    this.next = 0;
    this.text = "";
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (
        let end = buffer.indexOf("\n");
        end >= 0;
        end = buffer.indexOf("\n")
      ) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) this.receive(line);
      }
    });
    child.once("close", () => {
      for (const reject of this.pending.values())
        reject(new Error("OpenCode ACP ended"));
      this.pending.clear();
    });
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method === undefined && this.pending.has(message.id)) {
      const settle = this.pending.get(message.id);
      this.pending.delete(message.id);
      settle(message);
      return;
    }
    if (message.method === "session/update") {
      const update = message.params?.update;
      if (
        update?.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text"
      )
        this.text += update.content.text;
      return;
    }
    if (message.id === undefined) return;
    const result =
      message.method === "session/request_permission"
        ? { outcome: this.decide(message.params?.options ?? []) }
        : undefined;
    this.child.stdin.write(
      JSON.stringify(
        result
          ? { jsonrpc: "2.0", id: message.id, result }
          : {
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: "Method not supported" },
            },
      ) + "\n",
    );
  }

  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, (message) =>
        message.error
          ? reject(acpError(message.error))
          : resolve(message.result),
      );
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
}

function acpError(error) {
  const failure = new Error("OpenCode ACP request failed");
  failure.acpCode = error?.code;
  failure.acpText = `${error?.message ?? ""} ${JSON.stringify(error?.data ?? {})}`;
  return failure;
}

function startAcp(environment, directory, decide = refuse) {
  const child = spawn(
    "opencode",
    ["acp", "--port", "0", "--hostname", "127.0.0.1"],
    {
      cwd: directory,
      env: {
        ...environment,
        OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("base64url"),
      },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  child.stdin.on("error", () => child.kill("SIGKILL"));
  return { child, client: new AcpClient(child, decide) };
}

function refuse(options) {
  const reject = options.find((option) => option.kind?.startsWith("reject"));
  return reject
    ? { outcome: "selected", optionId: reject.optionId }
    : { outcome: "cancelled" };
}

function approve(options) {
  const allow = options.find((option) => option.kind === "allow_once");
  return allow
    ? { outcome: "selected", optionId: allow.optionId }
    : refuse(options);
}

function selectors(session) {
  return new Map(
    (session?.configOptions ?? []).map((option) => [option.id, option]),
  );
}

/** Opens a session and judges the contract Pages relies on; no prompt or model call. */
async function openSession(client, directory, mcpServers) {
  const initialized = await client.call("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
  });
  if (initialized?.agentInfo?.name !== "OpenCode")
    return { reason: "agent_mismatch" };
  if (initialized.protocolVersion !== 1) return { reason: "protocol_mismatch" };
  const session = await client.call("session/new", {
    cwd: directory,
    mcpServers,
  });
  const options = selectors(session);
  if (
    typeof session?.sessionId !== "string" ||
    options.get("model")?.type !== "select" ||
    options.get("mode")?.type !== "select"
  )
    return { reason: "selectors_missing" };
  return {
    reason: null,
    version: initialized.agentInfo.version,
    sessionId: session.sessionId,
    options,
  };
}

/** Starts the installed OpenCode over ACP without a model call and compares its contract. */
export async function checkOpenCodeAcp(environment, version) {
  const directory = await mkdtemp(join(tmpdir(), "pages-opencode-check-"));
  const { child, client } = startAcp(environment, directory);
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    const opened = await openSession(client, directory, []);
    if (opened.reason) return { status: "incompatible", reason: opened.reason };
    if (opened.version !== version)
      return { status: "incompatible", reason: "agent_mismatch" };
    return version === VERIFIED_OPENCODE_VERSION
      ? { status: "verified", reason: "exact_version" }
      : { status: "compatible", reason: "contract_matches" };
  } catch {
    return { status: "incompatible", reason: "probe_failed" };
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
}

let checked = null;

/** What OpenCode offers on this host with the providers set up here; no prompt is sent. */
export async function openCodeInventory(base, context = {}) {
  const environment = openCodeEnvironment(base);
  const version = await run(environment, ["--version"], context);
  if (version.missing) return null;
  const entry = {
    tool: "opencode",
    version:
      /\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,30}/.exec(version.stdout)?.[0] ?? null,
    authentication: "unknown",
    models: [],
    providers: [],
  };
  const listing = await run(environment, ["models", "--verbose"], {
    ...context,
    timeout: 60000,
  });
  if (listing.ok) entry.models = readOpenCodeListing(listing.stdout);
  entry.providers = [
    ...new Set(entry.models.map((model) => model.id.split("/")[0])),
  ].slice(0, 100);
  entry.authentication = entry.models.length ? "authenticated" : "unknown";
  if (checked?.version !== entry.version)
    checked = {
      version: entry.version,
      acp: await checkOpenCodeAcp(environment, entry.version),
    };
  entry.acp = checked.acp;
  entry.catalogRevision = createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
  return entry;
}

/** The managed primary agents and native rules, as Pages runs OpenCode locally. */
function runConfiguration(job) {
  const read = { "*": "allow", "*.env": "deny", "*.env.*": "deny" };
  const permission =
    job.access === "yolo"
      ? { "*": "allow", read }
      : {
          "*": "deny",
          read,
          list: "allow",
          glob: "allow",
          grep: "allow",
          webfetch: "allow",
          websearch: "allow",
          "pages_*": "allow",
        };
  const mode = job.access === "yolo" ? "pages-yolo" : "pages-read-only";
  const variant = job.reasoningEffort ?? "default";
  return {
    ...SAFE_SETTINGS,
    model: job.model,
    small_model: job.model,
    enabled_providers: [job.model.split("/")[0]],
    default_agent: mode,
    permission,
    agent: {
      [mode]: { mode: "primary", model: job.model, variant, permission },
      build: { disable: true },
      plan: { disable: true },
      general: { model: job.model, variant },
      explore: { model: job.model, variant },
      title: { disable: true },
      summary: { disable: true },
      compaction: { model: job.model, variant },
    },
    compaction: { auto: true },
  };
}

/** Maps a native failure to a stable Pages code; provider text never leaves this process. */
export function classifyOpenCodeFailure(text) {
  if (/FreeTierError|free tier can only be used/iu.test(text))
    return "opencode_free_tier_refused";
  if (
    /\b401\b|invalid[ _-]?(?:api[ _-]?)?key|unauthori[sz]ed|authentication[ _-]?(?:error|required)|ProviderAuthError/iu.test(
      text,
    )
  )
    return "provider_auth_failed";
  if (
    /\b402\b|insufficient[ _-]?(?:credits?|funds?|balance|quota)|(?:balance|credits?|quota)[^\n]{0,50}(?:exhausted|depleted|exceeded|zero)|payment required|usage limit|recharge/iu.test(
      text,
    )
  )
    return "provider_quota_exhausted";
  if (/\b429\b|rate[ _-]?limit/iu.test(text)) return "provider_rate_limited";
  if (
    /ProviderModelNotFoundError|ModelNotFoundError|model[^\n]{0,80}(?:not found|not available|unavailable|not supported)|\b404\b/iu.test(
      text,
    )
  )
    return "provider_model_not_found";
  if (/\b403\b|forbidden/iu.test(text)) return "provider_permission_denied";
  if (/\b50[0234]\b|service unavailable|provider unavailable/iu.test(text))
    return "provider_unavailable";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network error/iu.test(text))
    return "provider_unreachable";
  return "opencode_acp_session_failed";
}

/** Sets one selector to an offered value and returns the selectors as they are afterwards. */
async function choose(client, session, choice) {
  const [id, value, refusal] = choice;
  const refused = () =>
    Object.assign(new Error("Selection refused"), { pagesCode: refusal });
  if (
    !session.options.get(id)?.options?.some((option) => option.value === value)
  )
    throw refused();
  const result = await client.call("session/set_config_option", {
    sessionId: session.sessionId,
    configId: id,
    value,
  });
  const options = selectors(result);
  if (options.get(id)?.currentValue !== value) throw refused();
  return { ...session, options };
}

async function executeJob(job, prompt) {
  const environment = openCodeEnvironment(process.env, runConfiguration(job));
  const decide = job.access === "yolo" ? approve : refuse;
  const { child, client } = startAcp(environment, job.workspace, decide);
  try {
    const opened = await openSession(client, job.workspace, job.mcpServers);
    if (opened.reason)
      throw Object.assign(new Error("Contract"), {
        pagesCode: "opencode_acp_unsupported",
      });
    let session = await choose(client, opened, [
      "mode",
      job.access === "yolo" ? "pages-yolo" : "pages-read-only",
      "opencode_acp_unsupported",
    ]);
    session = await choose(client, session, [
      "model",
      job.model,
      "plan_model_unavailable",
    ]);
    // The effort selector belongs to the chosen model, so it is read after the model.
    if (job.reasoningEffort !== null)
      await choose(client, session, [
        "effort",
        job.reasoningEffort,
        "plan_reasoning_unsupported",
      ]);
    const turn = await client.call("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    if (turn?.stopReason !== "end_turn" || !client.text.trim())
      return { error: "opencode_acp_session_failed" };
    return { answer: client.text };
  } finally {
    child.kill("SIGKILL");
  }
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The process the runner's worker starts for one OpenCode node; it prints one JSON line. */
async function main() {
  const job = JSON.parse(process.env.PAGES_OPENCODE_JOB ?? "{}");
  delete process.env.PAGES_OPENCODE_JOB;
  let result;
  try {
    result = await executeJob(job, await readInput());
  } catch (error) {
    result = {
      error:
        error.pagesCode ??
        classifyOpenCodeFailure(error.acpText ?? String(error.message)),
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.answer ? 0 : 1;
}

/** Projects the final answer of the ACP process; the failure stays a stable code. */
export function openCodeResult(stdout) {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  try {
    const result = JSON.parse(line);
    return {
      answer: typeof result.answer === "string" ? result.answer : "",
      failureCode: typeof result.error === "string" ? result.error : undefined,
    };
  } catch {
    return { answer: "", failureCode: undefined };
  }
}

/** The command line that runs one OpenCode node through this module. */
export function openCodeCommand() {
  return [fileURLToPath(import.meta.url), "--acp"];
}

/** The banner each answer starts with, as for the other remote CLIs. */
export function remoteBanner(workspace) {
  return `Remote host: ${hostname()}\nRemote workspace: ${workspace}\n\n`;
}

if (process.argv[2] === "--acp") await main();
