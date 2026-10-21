import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";

/** Name of the variable through which the askpass helper receives the one secret it may answer with. */
export const SSH_SECRET_VARIABLE = "PAGES_SSH_SECRET";

const ASKPASS_SCRIPT = `#!/bin/sh\nprintf '%s\\n' "$${SSH_SECRET_VARIABLE}"\n`;

/**
 * A private folder of one SSH operation: the pinned `known_hosts`, a key file
 * and a control socket.
 *
 * @remarks
 * The folder is readable by the server account only and is removed as soon
 * as the operation no longer needs it; a key file is removed even earlier.
 */
export interface SshScope {
  readonly directory: string;
  /** The helper that answers OpenSSH's password or passphrase prompt. */
  readonly askpass: string;
  /** Writes a file only the server account can read. */
  write(name: string, content: string): Promise<string>;
  /** Removes one file of the scope, such as a key file after the connect. */
  discard(name: string): Promise<void>;
  /** Removes the scope with everything in it. */
  remove(): Promise<void>;
}

/**
 * Owns the private runtime folder of all SSH work of this server process.
 *
 * @remarks
 * It lies in the temporary directory because control socket paths must stay
 * short; it is created with owner-only permissions and removed at shutdown.
 */
export class SshRuntimeDirectory {
  private readonly base: string;
  private root: Promise<string> | null = null;

  public constructor(base: string = tmpdir()) {
    this.base = base;
  }

  /** Creates the private folder of one operation. */
  public async createScope(): Promise<SshScope> {
    const root = await this.ensureRoot();
    const directory = await mkdtemp(path.join(root, "s-"));
    const askpass = path.join(root, "askpass");
    return {
      directory,
      askpass,
      write: async (name, content) => {
        const file = path.join(directory, name);
        await writeFile(file, content, { mode: 0o600 });
        return file;
      },
      discard: async (name) => {
        await rm(path.join(directory, name), { force: true });
      },
      remove: async () => {
        await rm(directory, { recursive: true, force: true });
      },
    };
  }

  /** Removes every remaining scope; called when the server stops. */
  public async dispose(): Promise<void> {
    const root = this.root;
    this.root = null;
    if (!root) return;
    try {
      await rm(await root, { recursive: true, force: true });
    } catch (error: unknown) {
      logCaughtError("SshRuntimeDirectory", error);
    }
  }

  private async ensureRoot(): Promise<string> {
    this.root ??= this.createRoot();
    try {
      return await this.root;
    } catch (error: unknown) {
      this.root = null;
      throw error;
    }
  }

  private async createRoot(): Promise<string> {
    // mkdtemp creates the folder with mode 0700.
    const root = await mkdtemp(path.join(this.base, "pages-ssh-"));
    const askpass = path.join(root, "askpass");
    await writeFile(askpass, ASKPASS_SCRIPT, { mode: 0o700 });
    await chmod(askpass, 0o700);
    return root;
  }
}
