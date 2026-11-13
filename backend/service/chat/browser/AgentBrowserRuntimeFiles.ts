import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PicaBrowserStorageState } from "./PicaBrowserSession";

/** Private per-conversation mounts outside working folders, in the protected instance runtime. */
export class AgentBrowserRuntimeFiles {
  private readonly directory: string;
  private root: Promise<string> | null = null;

  /** Uses the protected instance runtime in production; the temporary root is for isolated callers. */
  public constructor(directory: string = tmpdir()) {
    this.directory = directory;
  }

  /** Writes only this conversation's state, with permissions 0600, into its private mount. */
  public async write(
    conversation: string,
    storage: PicaBrowserStorageState,
  ): Promise<string> {
    this.root ??= this.prepareRoot();
    const directory = path.join(
      await this.root,
      createHash("sha256").update(conversation).digest("hex"),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "storage-state.json");
    await writeFile(file, JSON.stringify(storage), { mode: 0o600, flag: "wx" });
    return file;
  }

  /** Removes the file when its job ends; the empty mount serves the next round. */
  public async remove(file: string): Promise<void> {
    await rm(file, { force: true });
  }

  /** Removes all empty mounts on server shutdown. */
  public async close(): Promise<void> {
    if (this.root) await rm(await this.root, { recursive: true, force: true });
  }
  private async prepareRoot(): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return mkdtemp(path.join(this.directory, "pages-agent-browser-"));
  }
}
