import { quoteShellWord } from "@/backend/remote/SshOptions";
import serviceManagerFunctions from "@/scripts/runner/service-manager.sh?raw";
import { SETUP_TOOLS, hostObservationSchema } from "@/definition/RemoteSetup";

import type { HostObservation, SetupTool } from "@/definition/RemoteSetup";

/** Where the setup script installs the runner, relative to the SSH user's home. */
const RUNNER_DIRECTORY = ".local/share/pages-runner";

/** The package each tool is installed from below the runner's tool prefix. */
const TOOL_PACKAGES: Readonly<Record<SetupTool, string>> = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
  opencode: "opencode-ai",
};

const COMPLETE_LINE = "probe=complete";

/**
 * The probe: reads files, asks the machine's service manager and runs no tool of the setup.
 *
 * @remarks
 * Tool versions come from the package files of the tool prefix, never from
 * running a tool, so a probe after every connect cannot start a login, an
 * update or a long process. The service manager is detected and asked by the
 * same functions the setup script embeds (`service-manager.sh`), so the script
 * and Pages see one machine; registration and state come from `systemctl`,
 * `supervisorctl` or the process table, never from the presence of a file. A
 * machine that does not tell stays unknown.
 */
function probeScript(): string {
  const tools = SETUP_TOOLS.map(
    (tool) => `${tool}:${TOOL_PACKAGES[tool]}`,
  ).join(" ");
  return [
    "set -u",
    `runner_directory="$HOME/${RUNNER_DIRECTORY}"`,
    'runner="$runner_directory/runner.mjs"',
    'tools="$runner_directory/tools"',
    serviceManagerFunctions,
    "if [ -r /etc/os-release ]; then printf 'os=%s\\n' \"$(. /etc/os-release >/dev/null 2>&1; printf '%s' \"${ID:-}\")\"; fi",
    "printf 'arch=%s\\n' \"$(uname -m 2>/dev/null)\"",
    'if [ -f "$runner" ] && [ ! -L "$runner" ]; then',
    "  printf 'runner=1\\n'",
    '  printf \'runner_version=%s\\n\' "$(sed -n \'s/^const RUNNER_VERSION = "\\([0-9.]*\\)";$/\\1/p\' "$runner" 2>/dev/null | head -n 1)"',
    "else printf 'runner=0\\n'; fi",
    "detect_service_manager",
    "inspect_service",
    "report_service",
    `for entry in ${tools}; do`,
    '  tool="${entry%%:*}"; package="${entry#*:}"',
    '  if PATH="$tools/bin:$PATH" command -v "$tool" >/dev/null 2>&1; then',
    '    version=$(sed -n \'s/^ *"version": *"\\([^"]*\\)".*$/\\1/p\' "$tools/lib/node_modules/$package/package.json" 2>/dev/null | head -n 1)',
    '    printf \'tool=%s:%s\\n\' "$tool" "$version"',
    "  fi",
    "done",
    `printf '${COMPLETE_LINE}\\n'`,
  ].join("\n");
}

/**
 * The command line that runs the probe under a POSIX shell, whatever the login shell is.
 *
 * @returns One command for the SSH master.
 */
export function probeCommand(): string {
  return `/bin/sh -c ${quoteShellWord(probeScript())}`;
}

function valueOf(lines: ReadonlyMap<string, string>, key: string): string {
  return lines.get(key) ?? "";
}

function toolsOf(entries: readonly string[]): HostObservation["tools"] {
  return SETUP_TOOLS.flatMap((tool) => {
    const entry = entries.find((line) => line.startsWith(`${tool}:`));
    if (entry === undefined) return [];
    const version = entry.slice(tool.length + 1);
    return [{ tool, version: version === "" ? null : version }];
  });
}

/**
 * Reads the probe output into an observation.
 *
 * @remarks
 * Output of the machine is data, not instructions: only known keys count and
 * every value passes the observation schema, so a banner or a forged line
 * cannot change what Pages believes beyond the facts it asks for.
 *
 * @param output - Standard output of the probe command.
 * @returns The observation.
 * @throws When the output is incomplete or a value is not valid.
 */
export function parseProbeOutput(output: string): HostObservation {
  const lines = new Map<string, string>();
  const toolEntries: string[] = [];
  for (const line of output.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    if (key === "tool") toolEntries.push(value);
    else lines.set(key, value);
  }
  if (lines.get("probe") !== "complete") throw new Error("Incomplete probe");
  const version = valueOf(lines, "runner_version");
  return hostObservationSchema.parse({
    isUbuntu: lines.has("os") ? valueOf(lines, "os") === "ubuntu" : null,
    architecture: valueOf(lines, "arch") || null,
    serviceManager: valueOf(lines, "service_manager") || null,
    canQueryService: valueOf(lines, "service_query") === "1",
    isRunnerInstalled: valueOf(lines, "runner") === "1",
    runnerVersion: version === "" ? null : version,
    isServiceInstalled: valueOf(lines, "service_registered") === "1",
    isServiceEnabled: valueOf(lines, "service_enabled") === "1",
    isServiceActive: valueOf(lines, "service_active") === "1",
    tools: toolsOf(toolEntries),
  });
}
