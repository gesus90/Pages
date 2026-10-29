import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";

import type {
  CliProviderId,
  CliToolLocation,
  CliToolLocations,
} from "@/definition/AgentConnection";

/** The executable each CLI installs. */
export const CLI_BINARIES: Readonly<Record<CliProviderId, string>> = {
  codex_cli: "codex",
  claude_code: "claude",
  opencode: "opencode",
  antigravity: "agy_acp_server.par",
};

/** Locates externally installed CLIs through the filesystem; it never executes them. */
export class CliLocator {
  private readonly searchPath: string;
  private readonly nodePath: string;
  private readonly managed:
    ((binary: string) => Promise<CliToolLocation | null>) | undefined;

  public constructor(
    searchPath: string = process.env.PATH ?? "",
    nodePath: string = process.execPath,
    managed?: (binary: string) => Promise<CliToolLocation | null>,
  ) {
    this.searchPath = searchPath;
    this.nodePath = nodePath;
    this.managed = managed;
  }

  /** PATH wins, followed by the running Node binary's directory for nvm installations. */
  public async find(provider: CliProviderId): Promise<CliToolLocation> {
    return this.locate(CLI_BINARIES[provider]);
  }

  /**
   * Locates an executable that belongs to a CLI, such as the Codex ACP adapter.
   *
   * @param binary - The file name of the executable.
   * @returns Its path, searched like {@link CliLocator.find}.
   */
  public async locate(binary: string): Promise<CliToolLocation> {
    const managed = await this.managed?.(binary);
    if (managed?.path) return managed;
    const directories = [
      ...new Set([
        ...this.searchPath
          .split(path.delimiter)
          .filter((directory) => path.isAbsolute(directory)),
        path.dirname(this.nodePath),
      ]),
    ];
    for (const directory of directories) {
      const candidate = path.join(directory, binary);
      try {
        await access(candidate, constants.X_OK);
        if ((await stat(candidate)).isFile())
          return { found: true, path: candidate };
      } catch (caughtError: unknown) {
        logCaughtError("CliLocator", caughtError);

        // Missing and non-executable candidates do not prevent the fallback lookup.
        continue;
      }
    }
    return { found: false, path: null };
  }

  /** Lists every tool without touching authentication or running version commands. */
  public async list(): Promise<CliToolLocations> {
    const [codex, claude, opencode, antigravity] = await Promise.all([
      this.find("codex_cli"),
      this.find("claude_code"),
      this.find("opencode"),
      this.find("antigravity"),
    ]);
    return { codex_cli: codex, claude_code: claude, opencode, antigravity };
  }
}
