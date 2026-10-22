import type { ITheme, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

function terminalTheme(container: HTMLElement): ITheme {
  const styles = getComputedStyle(container);
  const color = (token: string): string =>
    styles.getPropertyValue(`--color-terminal-${token}`).trim();
  return {
    background: color("surface"),
    foreground: color("foreground"),
    cursor: color("foreground"),
    cursorAccent: color("surface"),
    selectionBackground: color("selection"),
    black: color("foreground"),
    brightBlack: color("muted"),
    white: color("foreground"),
    brightWhite: color("foreground"),
    red: color("error"),
    brightRed: color("error"),
    green: color("success"),
    brightGreen: color("success"),
    yellow: color("warning"),
    brightYellow: color("warning"),
    blue: color("info"),
    brightBlue: color("info"),
    magenta: color("accent"),
    brightMagenta: color("accent"),
    cyan: color("cyan"),
    brightCyan: color("cyan"),
  };
}

/**
 * Keys the panel handles instead of the shell: Escape asks before closing
 * (Strg+[ still sends ESC), Strg+Umschalt+C copies the selection, because
 * Strg+C interrupts the remote program. Strg+Umschalt+V pastes natively.
 */
function handlePanelKeys(terminal: Terminal, event: KeyboardEvent): boolean {
  if (event.key === "Escape") return false;
  const isCopy =
    event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyC";
  if (!isCopy) return true;
  if (event.type === "keydown" && terminal.hasSelection()) {
    // The copy event lets xterm write its selection, also outside secure contexts.
    document.execCommand("copy");
  }
  event.preventDefault();
  return false;
}

/** Browser-only terminal resources; callers dispose all observers with the terminal. */
export interface TerminalSurface {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  dispose(): void;
}

/** Loads xterm only in the browser and follows container size and the Pages theme. */
export async function createTerminalSurface(
  container: HTMLElement,
): Promise<TerminalSurface> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]);
  const terminal = new Terminal({
    cursorBlink: true,
    // The monospace stack of the Pages theme, at 15 px on 25 px rows.
    fontFamily:
      getComputedStyle(container).getPropertyValue("--font-mono").trim() ||
      "monospace",
    fontSize: 15,
    lineHeight: 1.52,
    scrollback: 3000,
    screenReaderMode: true,
    allowProposedApi: false,
    theme: terminalTheme(container),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.attachCustomKeyEventHandler((event) =>
    handlePanelKeys(terminal, event),
  );
  terminal.open(container);
  const resize = new ResizeObserver(() => fit.fit());
  resize.observe(container);
  const theme = new MutationObserver(() => {
    terminal.options.theme = terminalTheme(container);
  });
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const media = matchMedia("(prefers-color-scheme: dark)");
  const updateTheme = (): void => {
    terminal.options.theme = terminalTheme(container);
  };
  media.addEventListener("change", updateTheme);
  fit.fit();
  return {
    terminal,
    fit,
    dispose: () => {
      resize.disconnect();
      theme.disconnect();
      media.removeEventListener("change", updateTheme);
      terminal.dispose();
    },
  };
}
