import helperSource from "@/backend/agents/acp/PicaClaudeHelperRuntime.mjs?raw";

/**
 * Returns the executable text of the Claude Code helper.
 *
 * @param runtime - The absolute path of the Node executable that runs it.
 * @returns A script whose first line names that executable.
 */
export function picaHelperScript(runtime: string): string {
  return `#!${runtime}\n${helperSource}`;
}
