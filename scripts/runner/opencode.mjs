// OpenCode on the runner host (PAGE-154): inventory, ACP contract check and ACP execution.
// The host's own OpenCode configuration and keys are used; Pages sends none.
import { spawn, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { ProtocolLines } from "./lines.mjs";

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

/** A bounded ACP client; parsing, forwarded updates and input writes apply stream backpressure. */
export class OpenCodeAcpClient {
  #child;
  #decide;
  #publish;
  #pending = new Map();
  #next = 0;
  #text = "";
  #messageBytes = 0;
  #isMessageOpen = false;
  #messageId = null;
  #failure = null;
  constructor(child, decide, publish) {
    this.#child = child;
    this.#decide = decide;
    this.#publish = publish;
    child.once("error", (error) => this.#fail(error));
    child.once("close", () => this.#fail(new Error("OpenCode ACP ended")));
    void this.#read().catch((error) => {
      this.#fail(error);
      child.kill("SIGKILL");
    });
  }

  /** The current native message, empty after later tool activity until a new final message arrives. */
  get text() {
    return this.#text;
  }

  async #read() {
    const lines = new ProtocolLines((line) => this.#receive(JSON.parse(line)));
    for await (const chunk of this.#child.stdout) await lines.receive(chunk);
    await lines.finish();
  }

  #fail(error) {
    this.#failure ??= error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async #receive(message) {
    if (message.method === undefined && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending.reject(acpError(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "session/update") {
      await this.#update(message.params?.update);
      return;
    }
    if (message.id === undefined) return;
    const result =
      message.method === "session/request_permission"
        ? { outcome: this.#decide(message.params?.options ?? []) }
        : undefined;
    await this.#write(
      result
        ? { jsonrpc: "2.0", id: message.id, result }
        : {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not supported" },
          },
    );
  }

  async #update(update) {
    const isText =
      update?.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text";
    const isBoundary = [
      "agent_thought_chunk",
      "tool_call",
      "tool_call_update",
      "plan",
    ].includes(update?.sessionUpdate);
    if (
      isBoundary ||
      (isText && update.messageId && update.messageId !== this.#messageId)
    )
      await this.flushMessage();
    if (isBoundary) {
      this.#text = "";
      this.#messageBytes = 0;
    }
    if (isText) {
      if (!this.#isMessageOpen) {
        this.#text = "";
        this.#messageBytes = 0;
      }
      this.#messageBytes += Buffer.byteLength(update.content.text);
      if (this.#messageBytes > 1048576)
        throw Object.assign(new Error("OpenCode message exceeds 1 MiB"), {
          reason: "event_limit",
        });
      this.#text += update.content.text;
      this.#messageId = update.messageId ?? null;
      this.#isMessageOpen = true;
    }
    if (update?.sessionUpdate !== "agent_thought_chunk")
      await this.#publish?.({ type: "pages.update", update });
  }

  /** Projects one complete native message before its boundary, without retaining earlier messages. */
  async flushMessage() {
    if (!this.#isMessageOpen) return;
    await this.#publish?.({
      type: "pages.update",
      update: { sessionUpdate: "agent_message", text: this.#text },
    });
    this.#isMessageOpen = false;
  }

  async #write(message) {
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > 1048576)
      throw new Error("ACP input exceeds 1 MiB");
    await new Promise((resolve, reject) =>
      this.#child.stdin.write(line, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }

  /** Executes one bounded ACP request; at most eight requests may await their native responses. */
  async call(method, params) {
    if (this.#failure) throw this.#failure;
    if (this.#pending.size >= 8)
      throw new Error("OpenCode ACP request window full");
    const id = ++this.#next;
    const reply = new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject }),
    );
    try {
      await this.#write({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      this.#fail(error);
    }
    return reply;
  }
}

function acpError(error) {
  const failure = new Error("OpenCode ACP request failed");
  failure.acpCode = error?.code;
  failure.acpText = `${error?.message ?? ""} ${JSON.stringify(error?.data ?? {})}`;
  return failure;
}

function startAcp(environment, directory, decide = refuse, publish) {
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
  return { child, client: new OpenCodeAcpClient(child, decide, publish) };
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
  const { child, client } = startAcp(
    environment,
    job.workspace,
    decide,
    writeOutput,
  );
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
    await client.flushMessage();
    const receipt = {
      type: "pages.result",
      sessionId: session.sessionId,
      stopReason: turn?.stopReason,
      usage: turn?.usage ?? null,
    };
    if (turn?.stopReason !== "end_turn" || !client.text.trim())
      return { ...receipt, error: "opencode_acp_session_failed" };
    return { ...receipt, answer: client.text };
  } finally {
    child.kill("SIGKILL");
  }
}

async function readInput() {
  let input = "";
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1048576) throw new Error("OpenCode prompt exceeds 1 MiB");
    input += decoder.decode(chunk, { stream: true });
  }
  return input + decoder.decode();
}

async function writeOutput(event) {
  if (!process.stdout.write(`${JSON.stringify(event)}\n`))
    await once(process.stdout, "drain");
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
      type: "pages.result",
      stopReason: "error",
      error:
        error.pagesCode ??
        classifyOpenCodeFailure(error.acpText ?? String(error.message)),
    };
  }
  await writeOutput(result);
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

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === "--acp"
)
  await main();
