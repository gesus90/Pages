import type { ITheme, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * ANSI colors from the terminal tokens. Black is the selection tone, so a
 * full-screen program that paints a black background keeps its light text
 * readable, and black text stays visible on the dark surface. Bright white
 * takes the `strong` token where the palette has one.
 */
function terminalTheme(container: HTMLElement, palette: string): ITheme {
  const styles = getComputedStyle(container);
  const color = (token: string): string =>
    styles.getPropertyValue(`--color-${palette}-${token}`).trim();
  return {
    background: color("surface"),
    foreground: color("foreground"),
    cursor: color("foreground"),
    cursorAccent: color("surface"),
    selectionBackground: color("selection"),
    black: color("selection"),
    brightBlack: color("muted"),
    white: color("foreground"),
    brightWhite: color("strong") || color("foreground"),
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
 * Keys the panel handles instead of the shell. Escape and every other key
 * reach the remote program; Strg+Umschalt+X asks before closing the panel,
 * Strg+Umschalt+C copies the selection, because Strg+C interrupts the remote
 * program. Strg+Umschalt+V pastes natively.
 */
function handlePanelKeys(
  terminal: Terminal,
  event: KeyboardEvent,
  onCloseRequest: () => void,
): boolean {
  const isPanelChord = event.ctrlKey && event.shiftKey && !event.altKey;
  if (!isPanelChord || (event.code !== "KeyC" && event.code !== "KeyX"))
    return true;
  if (event.type === "keydown" && event.code === "KeyX") onCloseRequest();
  if (event.type === "keydown" && event.code === "KeyC") {
    // The copy event lets xterm write its selection, also outside secure contexts.
    if (terminal.hasSelection()) document.execCommand("copy");
  }
  event.preventDefault();
  return false;
}

/**
 * Draws with WebGL where the browser offers it; without WebGL or after a
 * lost context the same terminal keeps its session and scrollback on the
 * standard renderer.
 */
async function loadWebglRenderer(
  terminal: Terminal,
  container: HTMLElement,
): Promise<void> {
  container.dataset.renderer = "dom";
  try {
    const { WebglAddon } = await import("@xterm/addon-webgl");
    const renderer = new WebglAddon();
    renderer.onContextLoss(() => {
      renderer.dispose();
      container.dataset.renderer = "dom";
    });
    terminal.loadAddon(renderer);
    container.dataset.renderer = "webgl";
  } catch (error: unknown) {
    console.warn("WebGL terminal renderer unavailable", error);
  }
}

/** Browser-only terminal resources; callers dispose all observers with the terminal. */
export interface TerminalSurface {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  dispose(): void;
}

/** How the panel wants its terminal. */
export interface TerminalSurfaceOptions {
  /** Keeps an accessible copy of the screen for assistive technology. */
  readonly isScreenReaderMode: boolean;
  /** The panel's own way to close, since Escape belongs to the shell. */
  readonly onCloseRequest: () => void;
  /**
   * Fits columns and rows to the container; `false` keeps the geometry the
   * caller sets, such as that of a terminal another viewer sized.
   */
  readonly fitsContainer?: boolean;
  /** Lines kept above the screen; 3000 when absent. */
  readonly scrollback?: number;
  /** The token family of the colors, such as `agent-terminal`; `terminal` when absent. */
  readonly palette?: string;
  /** Row height as a multiple of the font size; 1.52 when absent. */
  readonly lineHeight?: number;
  /** Shows output only: no cursor and no keyboard input, as the Pages terminal of agent nodes (PAGE-284). */
  readonly isOutputOnly?: boolean;
}

/** Loads xterm only in the browser and follows container size and the Pages theme. */
export async function createTerminalSurface(
  container: HTMLElement,
  options: TerminalSurfaceOptions,
): Promise<TerminalSurface> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]);
  const palette = options.palette ?? "terminal";
  const isOutputOnly = options.isOutputOnly === true;
  const terminal = new Terminal({
    cursorBlink: !isOutputOnly,
    cursorInactiveStyle: isOutputOnly ? "none" : "outline",
    disableStdin: isOutputOnly,
    // The monospace stack of the Pages theme, at 15 px on 25 px rows.
    fontFamily:
      getComputedStyle(container).getPropertyValue("--font-mono").trim() ||
      "monospace",
    fontSize: 15,
    lineHeight: options.lineHeight ?? 1.52,
    scrollback: options.scrollback ?? 3000,
    screenReaderMode: options.isScreenReaderMode,
    allowProposedApi: false,
    theme: terminalTheme(container, palette),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.attachCustomKeyEventHandler((event) =>
    handlePanelKeys(terminal, event, options.onCloseRequest),
  );
  terminal.open(container);
  await loadWebglRenderer(terminal, container);
  // Size changes are measured once per frame; xterm reports only a changed grid.
  let fitFrame = 0;
  const fitsContainer = options.fitsContainer !== false;
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => fit.fit());
  });
  if (fitsContainer) resize.observe(container);
  const updateTheme = (): void => {
    terminal.options.theme = terminalTheme(container, palette);
  };
  const theme = new MutationObserver(updateTheme);
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", updateTheme);
  if (fitsContainer) fit.fit();
  return {
    terminal,
    fit,
    dispose: () => {
      cancelAnimationFrame(fitFrame);
      resize.disconnect();
      theme.disconnect();
      media.removeEventListener("change", updateTheme);
      terminal.dispose();
    },
  };
}
