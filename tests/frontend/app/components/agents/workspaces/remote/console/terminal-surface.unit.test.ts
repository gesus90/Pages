import { expect, it, vi } from "vitest";

import { createTerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";

const terminalMocks = vi.hoisted(() => ({
  fit: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  open: vi.fn(),
  hasSelection: vi.fn(() => true),
  keyHandler: (event: KeyboardEvent): boolean => Boolean(event),
  contextLoss: () => {},
  rendererDispose: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public options: Record<string, unknown>;
    public loadAddon = terminalMocks.loadAddon;
    public open = terminalMocks.open;
    public dispose = terminalMocks.dispose;
    public hasSelection = terminalMocks.hasSelection;
    public constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    /** Captures the keyboard handler so shortcuts can be exercised. */
    public attachCustomKeyEventHandler(
      handler: (event: KeyboardEvent) => boolean,
    ): void {
      terminalMocks.keyHandler = handler;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    public fit = terminalMocks.fit;
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    public dispose = terminalMocks.rendererDispose;
    /** Captures the context-loss listener. */
    public onContextLoss(callback: () => void): void {
      terminalMocks.contextLoss = callback;
    }
  },
}));

it("configures the terminal, handles panel shortcuts and falls back after context loss", async () => {
  const container = document.createElement("div");
  container.style.setProperty("--color-terminal-surface", "#123456");
  container.style.setProperty("--color-terminal-foreground", "#eeeeee");
  const close = vi.fn();
  const copy = vi.fn();
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: copy,
  });
  const surface = await createTerminalSurface(container, {
    isScreenReaderMode: true,
    onCloseRequest: close,
  });
  expect(surface.terminal.options.screenReaderMode).toBe(true);
  expect(surface.terminal.options.theme?.background).toBe("#123456");
  expect(surface.terminal.options.theme?.brightWhite).toBe("#eeeeee");
  expect(terminalMocks.fit).toHaveBeenCalled();
  expect(container.dataset.renderer).toBe("webgl");
  expect(
    terminalMocks.keyHandler(
      new KeyboardEvent("keydown", {
        code: "KeyC",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    ),
  ).toBe(false);
  expect(copy).toHaveBeenCalledWith("copy");
  expect(
    terminalMocks.keyHandler(
      new KeyboardEvent("keydown", {
        code: "KeyX",
        ctrlKey: true,
        shiftKey: true,
      }),
    ),
  ).toBe(false);
  expect(close).toHaveBeenCalledOnce();
  expect(
    terminalMocks.keyHandler(
      new KeyboardEvent("keydown", {
        code: "KeyX",
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
      }),
    ),
  ).toBe(true);
  terminalMocks.contextLoss();
  expect(container.dataset.renderer).toBe("dom");
  expect(terminalMocks.rendererDispose).toHaveBeenCalledOnce();
  surface.dispose();
  expect(terminalMocks.dispose).toHaveBeenCalledOnce();
});

it("uses output-only settings and does not fit a fixed-size terminal", async () => {
  terminalMocks.fit.mockClear();
  const surface = await createTerminalSurface(document.createElement("div"), {
    isScreenReaderMode: false,
    onCloseRequest: vi.fn(),
    fitsContainer: false,
    isOutputOnly: true,
    fontSize: 12,
    lineHeight: 1.2,
    scrollback: 50,
    palette: "agent-terminal",
  });
  expect(surface.terminal.options.disableStdin).toBe(true);
  expect(surface.terminal.options.cursorInactiveStyle).toBe("none");
  expect(surface.terminal.options.fontSize).toBe(12);
  expect(surface.terminal.options.lineHeight).toBe(1.2);
  expect(surface.terminal.options.scrollback).toBe(50);
  expect(terminalMocks.fit).not.toHaveBeenCalled();
  surface.dispose();
});
