import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pagesRequest } from "./pages.mjs";
import { localCliEnvironment } from "./local-accounts.mjs";
import { browserServer } from "./browser.mjs";
import { antigravityInventory, antigravityCommand } from "./antigravity.mjs";
import {
  openCodeCommand,
  openCodeInventory,
  openCodeResult,
  remoteBanner,
} from "./opencode.mjs";

// Optional MCP startup can omit a slow catalog from the first turn entirely.
// Match the local Codex ACP wait; required Pages access must precede inference.
const PAGES_MCP_STARTUP_SECONDS = 30;

/** Keeps CLI credentials on this host; no Pages environment or provider key is inherited. */
export function cliEnvironment(accountHome) {
  const home = accountHome ?? process.env.PAGES_RUNNER_CLI_HOME ?? homedir();
  if (!home.startsWith("/") || home.includes("\0"))
    throw new Error("Invalid remote CLI home");
  return {
    ...(process.env.PAGES_RUNNER_FULL_ENVIRONMENT === "1" ? process.env : {}),
    HOME: home,
    ...(accountHome || process.env.PAGES_RUNNER_AGENT_ACCOUNT === "1"
      ? { PAGES_RUNNER_AGENT_ACCOUNT: "1" }
      : {}),
    ...(process.env.PAGES_RUNNER_JOB_NAMESPACE === "1"
      ? {
          TMPDIR: "/tmp",
          TEMP: "/tmp",
          TMP: "/tmp",
          NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
        }
      : {}),
    PATH:
      process.env.PAGES_RUNNER_CLI_PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    ...(process.env.PAGES_RUNNER_LOCAL === "1" &&
    (accountHome || process.env.PAGES_RUNNER_AGENT_ACCOUNT === "1")
      ? localCliEnvironment(home)
      : {}),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    DISABLE_AUTOUPDATER: "1",
  };
}

// The CLI keeps the exact model it was asked for: no fallback to another model, no remap of a retired name.
const CLAUDE_EXACT_MODEL = {
  CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: "1",
  CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: "1",
};

function inspect(tool, args, input, context = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      tool,
      args,
      {
        env: {
          ...(context.environment ?? cliEnvironment(context.home)),
          ...(context.jobId ? { PAGES_REMOTE_JOB: context.jobId } : {}),
        },
        signal: context.signal,
        timeout: 15000,
        maxBuffer: 1048576,
      },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          missing: error?.code === "ENOENT",
          stdout,
          stderr,
        }),
    );
    child.stdin.on("error", () => child.kill());
    child.stdin.end(input);
  });
}

function modelsOf(tool, stdout) {
  if (tool === "codex") {
    const entries = JSON.parse(stdout).models;
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => entry.visibility === "list")
      .map((entry) => ({
        id: entry.slug,
        name: entry.display_name ?? entry.slug,
        reasoningEfforts: (entry.supported_reasoning_levels ?? []).map(
          (level) => level.effort,
        ),
      }));
  }
  const reply = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find(
      (message) =>
        message.type === "control_response" &&
        message.response?.request_id === "pages-model-catalog",
    );
  const entries = reply?.response?.response?.models;
  if (reply?.response?.subtype !== "success" || !Array.isArray(entries))
    return [];
  return entries
    .filter((entry) => !entry.disabled)
    .map((entry) => ({
      id: entry.resolvedModel ?? entry.value,
      name: entry.displayName ?? entry.value,
      reasoningEfforts: entry.supportedEffortLevels ?? [],
    }));
}

function catalogArguments(tool) {
  if (tool === "codex") return ["debug", "models"];
  return [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--safe-mode",
  ];
}

function validModel(model) {
  return (
    typeof model.id === "string" &&
    /^[a-zA-Z0-9/~_.:+-]{1,200}$/.test(model.id) &&
    typeof model.name === "string" &&
    /^[^\p{Cc}]{1,200}$/u.test(model.name) &&
    Array.isArray(model.reasoningEfforts) &&
    model.reasoningEfforts.length <= 10 &&
    model.reasoningEfforts.every(
      (effort) => typeof effort === "string" && /^[a-z_]{1,40}$/.test(effort),
    )
  );
}

/** Queries status and the CLI picker only; no user prompt or paid model turn is sent. */
export async function cliInventory(context = {}) {
  const tools = [];
  for (const tool of ["codex", "claude"]) {
    context.signal?.throwIfAborted();
    const version = await inspect(tool, ["--version"], undefined, context);
    if (version.missing) continue;
    const entry = {
      tool,
      version:
        /\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,30}/.exec(version.stdout)?.[0] ?? null,
      authentication: "unknown",
      models: [],
    };
    try {
      const status = await inspect(
        tool,
        tool === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
        undefined,
        context,
      );
      const isLoggedIn =
        tool === "codex"
          ? status.ok &&
            /Logged in using ChatGPT/.test(status.stdout + status.stderr)
          : status.ok &&
            JSON.parse(status.stdout).loggedIn === true &&
            JSON.parse(status.stdout).authMethod === "claude.ai";
      entry.authentication = isLoggedIn ? "authenticated" : "not_logged_in";
      if (isLoggedIn) {
        const input =
          tool === "claude"
            ? JSON.stringify({
                type: "control_request",
                request_id: "pages-model-catalog",
                request: {
                  subtype: "initialize",
                  hooks: {},
                  agents: {},
                  sdkMcpServers: [],
                },
              }) + "\n"
            : undefined;
        const catalog = await inspect(
          tool,
          catalogArguments(tool),
          input,
          context,
        );
        if (catalog.ok)
          entry.models = [
            ...new Map(
              modelsOf(tool, catalog.stdout)
                .filter(validModel)
                .map((model) => [model.id, model]),
            ).values(),
          ].slice(0, 1000);
      }
    } catch {
      // A failed status or picker stays unknown/empty, without leaking CLI diagnostics.
    }
    entry.catalogRevision = createHash("sha256")
      .update(JSON.stringify(entry))
      .digest("hex");
    tools.push(entry);
  }
  context.signal?.throwIfAborted();
  const openCode = await openCodeInventory(
    context.environment ?? cliEnvironment(context.home),
    context,
  );
  if (openCode) tools.push(openCode);
  const antigravity = await antigravityInventory(
    context.environment ?? cliEnvironment(context.home),
    context,
  );
  if (antigravity) tools.push(antigravity);
  context.signal?.throwIfAborted();
  return tools;
}

/**
 * The `codex exec` command line of one job.
 * @remarks
 * A continuation job keeps its rollout on this host, so the session is not
 * ephemeral; a retry then runs `exec resume` with the recorded thread. The
 * options of the subcommand follow it, while folder and colour stay with
 * `exec`, as the CLI accepts them.
 */
function codexArguments(command, pagesArgs) {
  const program = command.program;
  const continuation = command.continuation;
  const resume = continuation?.resumeSessionId;
  const options = [
    "--skip-git-repo-check",
    ...(continuation ? [] : ["--ephemeral"]),
    "--ignore-user-config",
    ...(resume ? [] : ["--color", "never"]),
    "--json",
    ...(resume ? [] : ["-C", command.workspace]),
    "-m",
    program.model,
    "-c",
    "mcp_servers={}",
    "-c",
    "features.apps=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.multi_agent=false",
  ];
  const args = resume
    ? [
        "exec",
        "--color",
        "never",
        "-C",
        command.workspace,
        ...(program.access === "read_only" ? ["--sandbox", "read-only"] : []),
        "resume",
        ...options,
      ]
    : ["exec", ...options];
  if (program.access !== "read_only")
    args.push("--dangerously-bypass-approvals-and-sandbox");
  else
    args.push(
      ...(resume ? [] : ["--sandbox", "read-only"]),
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.unified_exec=false",
      "-c",
      "features.apply_patch_freeform=false",
      "-c",
      "features.code_mode=false",
    );
  if (program.purpose) args.push("-c", 'web_search="disabled"');
  if (program.reasoningEffort !== null)
    args.push("-c", `model_reasoning_effort="${program.reasoningEffort}"`);
  args.push(...pagesArgs);
  if (resume) args.push(resume);
  args.push("-");
  return args;
}

function claudeArguments(command, pagesArgs) {
  const program = command.program;
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--max-turns",
    "200",
    "--strict-mcp-config",
    // A continuation job keeps its session on this host so that a retry can resume it.
    ...(command.continuation ? [] : ["--no-session-persistence"]),
    ...(command.continuation?.resumeSessionId
      ? ["--resume", command.continuation.resumeSessionId]
      : []),
    ...(command.pagesAccess === 1 || command.browser === 1
      ? [
          "--setting-sources",
          "",
          "--disable-slash-commands",
          "--settings",
          JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false }),
        ]
      : ["--safe-mode"]),
    "--model",
    program.model,
  ];
  if (program.access !== "read_only")
    args.push(
      "--permission-mode",
      "bypassPermissions",
      "--dangerously-skip-permissions",
    );
  else
    args.push(
      "--tools",
      "Read,Glob,Grep,WebSearch,WebFetch",
      "--allowedTools",
      "WebSearch,WebFetch",
      "--permission-mode",
      "dontAsk",
    );
  if (program.reasoningEffort !== null)
    args.push("--effort", program.reasoningEffort);
  if (program.purpose) args.push("--tools", "");
  args.push(...pagesArgs);
  return args;
}

/** Runs one OpenCode node over ACP with the host's own providers; no key comes from Pages. */
async function spawnOpenCode(command, jobId, signal, folder) {
  const program = command.program;
  const context =
    command.runtimeContext ??
    (program.linkedProvider
      ? await pagesRequest(join(folder, "..", "..", "pages.sock"), jobId, {
          kind: "turn-context",
        })
      : null);
  const environment = {
    ...cliEnvironment(),
    ...context?.environment,
    ...(context?.auth ? { OPENCODE_AUTH_CONTENT: context.auth } : {}),
  };
  const inventory = program.linkedProvider
    ? null
    : await openCodeInventory(environment, { signal });
  const model = inventory?.models.find((entry) => entry.id === program.model);
  if (
    !program.linkedProvider &&
    (!inventory ||
      inventory.acp?.status === "incompatible" ||
      (!command.managed?.connectionId &&
        !command.managed?.ownerId &&
        inventory.catalogRevision !== program.route.catalogRevision) ||
      !model ||
      (program.reasoningEffort !== null &&
        !model.reasoningEfforts.includes(program.reasoningEffort)) ||
      !["read_only", "yolo", "full_environment"].includes(program.access))
  )
    throw new Error("CLI selection unavailable");
  signal.throwIfAborted();
  const servers = await cliMcpServers(command, folder, jobId);
  return spawnManagedCli(command, process.execPath, openCodeCommand(), {
    cwd: command.workspace,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...environment,
      PAGES_REMOTE_JOB: jobId,
      PAGES_OPENCODE_JOB: JSON.stringify({
        workspace: command.workspace,
        model: program.model,
        reasoningEffort: program.reasoningEffort,
        access: program.access,
        purpose: program.purpose,
        providerConfiguration: context?.providerConfiguration,
        resumeSessionId: command.continuation?.resumeSessionId,
        mcpServers: servers,
      }),
    },
  });
}

async function spawnAntigravity(command, jobId, signal, folder) {
  const program = command.program;
  const environment = {
    ...cliEnvironment(),
    ...command.runtimeContext?.environment,
  };
  const inventory = await antigravityInventory(environment, { signal });
  const model = inventory?.models.find((entry) => entry.id === program.model);
  if (
    inventory?.acp?.status !== "verified" ||
    inventory.authentication !== "authenticated" ||
    (!command.managed?.ownerId &&
      inventory.catalogRevision !== program.route.catalogRevision) ||
    !model ||
    (program.reasoningEffort !== null &&
      !model.reasoningEfforts.includes(program.reasoningEffort)) ||
    !["read_only", "yolo", "full_environment"].includes(program.access)
  )
    throw new Error(
      "Antigravity selection unavailable; update the runner or reconnect this execution context",
    );
  signal.throwIfAborted();
  const servers = await cliMcpServers(command, folder, jobId);
  return spawnManagedCli(command, process.execPath, antigravityCommand(), {
    cwd: command.workspace,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...cliEnvironment(),
      ...command.runtimeContext?.environment,
      ...(process.env.PAGES_RUNNER_ANTIGRAVITY_HOME
        ? {
            PAGES_RUNNER_ANTIGRAVITY_HOME:
              process.env.PAGES_RUNNER_ANTIGRAVITY_HOME,
          }
        : {}),
      ...(process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT
        ? {
            PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT:
              process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT,
          }
        : {}),
      PAGES_RUNNER_JOB_NAMESPACE: process.env.PAGES_RUNNER_JOB_NAMESPACE,
      PAGES_RUNNER_CONTEXT_PROOF: process.env.PAGES_RUNNER_CONTEXT_PROOF,
      PAGES_REMOTE_JOB: jobId,
      PAGES_ANTIGRAVITY_JOB: JSON.stringify({
        workspace: command.workspace,
        model: program.model,
        reasoningEffort: program.reasoningEffort,
        access: program.access === "full_environment" ? "yolo" : program.access,
        purpose: program.purpose,
        resumeSessionId: command.continuation?.resumeSessionId,
        mcpServers: servers,
      }),
    },
  });
}

/** Rechecks the exact remote catalog and login before starting the original requested tool. */
export async function spawnCli(command, jobId, signal, folder) {
  const program = command.program;
  const tool = program.route.tool;
  if (tool === "antigravity")
    return spawnAntigravity(command, jobId, signal, folder);
  if (tool === "opencode") return spawnOpenCode(command, jobId, signal, folder);
  const inventory = (
    await cliInventory({
      jobId,
      signal,
      environment: {
        ...cliEnvironment(),
        ...command.runtimeContext?.environment,
      },
    })
  ).find((entry) => entry.tool === tool);
  const model = inventory?.models.find((entry) => entry.id === program.model);
  if (inventory?.authentication !== "authenticated")
    throw Object.assign(new Error("Runner agent account login required"), {
      failureCode: "provider_auth_failed",
    });
  if (
    (!command.managed?.ownerId &&
      inventory.catalogRevision !== program.route.catalogRevision) ||
    !model ||
    (program.reasoningEffort !== null &&
      !model.reasoningEfforts.includes(program.reasoningEffort)) ||
    !["read_only", "yolo", "full_environment"].includes(program.access)
  )
    throw new Error("CLI selection unavailable");
  signal.throwIfAborted();
  const mcpArguments = await pagesArguments(command, folder, jobId);
  return spawnManagedCli(
    command,
    tool,
    tool === "codex"
      ? codexArguments(command, mcpArguments)
      : claudeArguments(command, mcpArguments),
    {
      cwd: command.workspace,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...cliEnvironment(),
        ...command.runtimeContext?.environment,
        ...(tool === "claude" ? CLAUDE_EXACT_MODEL : {}),
        ...(tool === "claude" && command.pagesAccess === 1
          ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }
          : {}),
        PAGES_REMOTE_JOB: jobId,
      },
    },
  );
}

/** Keeps repository helpers immutable for every native tool and its descendants. */
function spawnManagedCli(command, executable, arguments_, options) {
  const directory = command.runtimeContext?.readOnlyDirectory;
  if (!directory) return spawn(executable, arguments_, options);
  if (
    typeof directory !== "string" ||
    !directory.startsWith("/") ||
    directory.includes("\0")
  )
    throw new Error("Invalid managed helper directory");
  return spawn(
    "/usr/bin/bwrap",
    [
      "--bind",
      "/",
      "/",
      "--ro-bind",
      directory,
      directory,
      "--",
      executable,
      ...arguments_,
    ],
    options,
  );
}

/** Projects only the final answer; tool traces and account metadata never become plan output. */
export function cliOutput(command, stdout) {
  let answer = "";
  try {
    if (["opencode", "antigravity"].includes(command.program.route.tool))
      answer = openCodeResult(stdout).answer;
    else if (command.program.route.tool === "claude") {
      const result = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .findLast((event) => event.type === "result");
      if (!result) return "";
      if (result.is_error) return "";
      answer = typeof result.result === "string" ? result.result : "";
    } else {
      for (const line of stdout.trim().split("\n")) {
        const event = JSON.parse(line);
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          answer = event.item.text;
      }
    }
  } catch {
    return "";
  }
  if (!answer || command.resultPayloadVersion === 1) return answer;
  return `${remoteBanner(command.workspace)}${answer}`;
}

/** The stable cause an OpenCode node names for its failure; other tools name none. */
export function cliFailure(command, stdout) {
  if (!["opencode", "antigravity"].includes(command.program.route.tool))
    return undefined;
  return openCodeResult(stdout).failureCode;
}

/** The short-lived Pages bridge process; no credential appears in its arguments. */
function pagesBridge(command, folder, jobId) {
  if (command.pagesAccess !== 1 || (command.managed && !command.managed.bridge))
    return null;
  return [
    fileURLToPath(new URL("./pages.mjs", import.meta.url)),
    "--mcp",
    join(folder, "..", "..", "pages.sock"),
    jobId,
  ];
}

/** Builds the same stdio MCP entries for all supported CLI adapters. */
async function cliMcpServers(command, folder, jobId) {
  const bridge = pagesBridge(command, folder, jobId);
  const browser = await browserServer(command, jobId);
  return [
    ...(bridge
      ? [{ name: "pages", command: process.execPath, args: bridge, env: [] }]
      : []),
    ...(browser ? [browser] : []),
  ];
}

/** Configures the authorized Pages and browser servers without credential arguments. */
async function pagesArguments(command, folder, jobId) {
  const servers = await cliMcpServers(command, folder, jobId);
  if (!servers.length) return [];
  if (command.program.route.tool === "codex")
    return servers.flatMap((server) => {
      const environment = server.env
        .map((entry) => `${entry.name}=${JSON.stringify(entry.value)}`)
        .join(",");
      return [
        "-c",
        `mcp_servers.${server.name}={command=${JSON.stringify(server.command)},args=${JSON.stringify(server.args)},env={${environment}},required=true,startup_timeout_sec=${PAGES_MCP_STARTUP_SECONDS}}`,
      ];
    });
  return [
    "--mcp-config",
    JSON.stringify({
      mcpServers: Object.fromEntries(
        servers.map((server) => [
          server.name,
          {
            command: server.command,
            args: server.args,
            env: Object.fromEntries(
              server.env.map((entry) => [entry.name, entry.value]),
            ),
          },
        ]),
      ),
    }),
    "--allowedTools",
    ...servers.map((server) => `mcp__${server.name}__*`),
  ];
}
