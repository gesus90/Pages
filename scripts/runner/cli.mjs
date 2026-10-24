import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

/** Keeps CLI credentials on this host; no Pages environment or provider key is inherited. */
export function cliEnvironment() {
  const home = process.env.PAGES_RUNNER_CLI_HOME ?? homedir();
  if (!home.startsWith("/") || home.includes("\0"))
    throw new Error("Invalid remote CLI home");
  return {
    HOME: home,
    PATH:
      process.env.PAGES_RUNNER_CLI_PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
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
          ...cliEnvironment(),
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
  return tools;
}

function codexArguments(command) {
  const program = command.program;
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--color",
    "never",
    "--json",
    "-C",
    command.workspace,
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
  if (program.access === "yolo")
    args.push("--dangerously-bypass-approvals-and-sandbox");
  else
    args.push(
      "--sandbox",
      "read-only",
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.unified_exec=false",
      "-c",
      "features.apply_patch_freeform=false",
      "-c",
      "features.code_mode=false",
    );
  if (program.reasoningEffort !== null)
    args.push("-c", `model_reasoning_effort="${program.reasoningEffort}"`);
  args.push("-");
  return args;
}

function claudeArguments(command) {
  const program = command.program;
  const args = [
    "-p",
    "--output-format",
    "json",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--safe-mode",
    "--model",
    program.model,
  ];
  if (program.access === "yolo")
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
  return args;
}

/** Rechecks the exact remote catalog and login before starting the original requested tool. */
export async function spawnCli(command, jobId, signal) {
  const program = command.program;
  const tool = program.route.tool;
  const inventory = (await cliInventory({ jobId, signal })).find(
    (entry) => entry.tool === tool,
  );
  const model = inventory?.models.find((entry) => entry.id === program.model);
  if (
    inventory?.authentication !== "authenticated" ||
    inventory.catalogRevision !== program.route.catalogRevision ||
    !model ||
    (program.reasoningEffort !== null &&
      !model.reasoningEfforts.includes(program.reasoningEffort)) ||
    !["read_only", "yolo"].includes(program.access)
  )
    throw new Error("CLI selection unavailable");
  signal.throwIfAborted();
  return spawn(
    tool,
    tool === "codex" ? codexArguments(command) : claudeArguments(command),
    {
      cwd: command.workspace,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...cliEnvironment(),
        ...(tool === "claude" ? CLAUDE_EXACT_MODEL : {}),
        PAGES_REMOTE_JOB: jobId,
      },
    },
  );
}

/** Projects only the final answer; tool traces and account metadata never become plan output. */
export function cliOutput(command, stdout) {
  let answer = "";
  try {
    if (command.program.route.tool === "claude") {
      const result = JSON.parse(stdout);
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
  return answer
    ? `Remote host: ${hostname()}\nRemote workspace: ${command.workspace}\n\n${answer}`
    : "";
}
