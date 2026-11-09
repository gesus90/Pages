import { createRequire } from "node:module";

import type * as XtermHeadless from "@xterm/headless";
import type * as XtermSerialize from "@xterm/addon-serialize";

/** Rows of an ordinary CLI kept for the serialized screen. */
const SCROLLBACK_ROWS = 2000;

const requireModule = createRequire(import.meta.url);

// Both packages are CommonJS bundles whose named exports Node cannot detect for an ES import.
function loadXterm(): {
  readonly headless: typeof XtermHeadless;
  readonly serialize: typeof XtermSerialize;
} {
  return {
    headless: requireModule("@xterm/headless") as typeof XtermHeadless,
    serialize: requireModule("@xterm/addon-serialize") as typeof XtermSerialize,
  };
}

/**
 * The screen of a terminal on the server: what a viewer sees when it opens
 * the terminal, and the terminal that answers the queries of the CLI.
 *
 * @remarks
 * It receives the redacted output only, so neither its screen nor its
 * answers carry a secret. A CLI such as OpenCode asks the terminal for its
 * colors and abilities before it draws; without a viewer only this terminal
 * answers, so a run never waits for a browser.
 */
export class TerminalScreen {
  private readonly terminal: XtermHeadless.Terminal;
  private readonly serializer: XtermSerialize.SerializeAddon;
  private written: Promise<void> = Promise.resolve();

  /**
   * @param size - Columns and rows of the pseudo terminal.
   * @param onReply - Receives the answers to queries of the CLI, for its input.
   */
  public constructor(
    size: { readonly columns: number; readonly rows: number },
    onReply: (reply: string) => void,
  ) {
    const { headless, serialize } = loadXterm();
    this.terminal = new headless.Terminal({
      cols: size.columns,
      rows: size.rows,
      scrollback: SCROLLBACK_ROWS,
      allowProposedApi: true,
    });
    this.serializer = new serialize.SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.terminal.onData(onReply);
  }

  /** Whether the CLI draws a full-screen interface in the alternate buffer. */
  public get isAlternateScreen(): boolean {
    return this.terminal.buffer.active.type === "alternate";
  }

  /** Columns and rows of the screen now. */
  public get size(): { readonly columns: number; readonly rows: number } {
    return { columns: this.terminal.cols, rows: this.terminal.rows };
  }

  /**
   * Applies redacted output in order.
   *
   * @param chunk - Output as the viewers receive it.
   * @returns Resolves once the screen shows the chunk.
   */
  public write(chunk: string): Promise<void> {
    this.written = this.written.then(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(chunk, resolve);
        }),
    );
    return this.written;
  }

  /** Changes the geometry the way the pseudo terminal changed it. */
  public resize(columns: number, rows: number): void {
    this.terminal.resize(columns, rows);
  }

  /**
   * The screen as control sequences that reproduce it in an empty terminal.
   *
   * @returns The serialized screen after every written chunk.
   */
  public async snapshot(): Promise<string> {
    await this.written;
    return this.serializer.serialize({
      scrollback: this.isAlternateScreen ? 0 : SCROLLBACK_ROWS,
    });
  }

  /** The visible rows as plain text, for a question the CLI shows only on its screen. */
  public text(): string {
    const buffer = this.terminal.buffer.active;
    const rows: string[] = [];
    for (let row = 0; row < this.terminal.rows; row += 1)
      rows.push(
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
      );
    return rows.join("\n");
  }

  /** Releases the screen. */
  public dispose(): void {
    this.terminal.dispose();
  }
}
