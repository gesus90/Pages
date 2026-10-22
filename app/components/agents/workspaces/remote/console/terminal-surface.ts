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
    fontSize: 14,
    lineHeight: 1.6,
    scrollback: 3000,
    screenReaderMode: true,
    allowProposedApi: false,
    theme: terminalTheme(container),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
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
  terminal.focus();
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
