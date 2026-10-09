import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import type {
  CliProviderId,
  CliToolLocation,
  CliToolLocations,
} from "@/definition/AgentConnection";

/** Locates externally installed CLIs through the filesystem; it never executes them. */
export class CliLocator {
  private readonly searchPath: string;
  private readonly nodePath: string;

  public constructor(
    searchPath: string = process.env.PATH ?? "",
    nodePath: string = process.execPath,
  ) {
    this.searchPath = searchPath;
    this.nodePath = nodePath;
  }

  /** PATH wins, followed by the running Node binary's directory for nvm installations. */
  public async find(provider: CliProviderId): Promise<CliToolLocation> {
    const binary = provider === "codex_cli" ? "codex" : "claude";
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
      } catch {
        // Missing and non-executable candidates do not prevent the fallback lookup.
        continue;
      }
    }
    return { found: false, path: null };
  }

  /** Lists both tools without touching authentication or running version commands. */
  public async list(): Promise<CliToolLocations> {
    const [codex, claude] = await Promise.all([
      this.find("codex_cli"),
      this.find("claude_code"),
    ]);
    return { codex_cli: codex, claude_code: claude };
  }
}
