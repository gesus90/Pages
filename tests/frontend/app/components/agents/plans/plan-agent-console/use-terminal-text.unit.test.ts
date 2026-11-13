import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  useTerminalColumns,
  useTerminalText,
} from "@/app/components/agents/plans/plan-agent-console/use-terminal-text";

import type { TerminalSurface } from "@/app/components/agents/workspaces/remote/console/terminal-surface";

function createSurface(): TerminalSurface {
  return { terminal: new Terminal(), fit: new FitAddon(), dispose: vi.fn() };
}

it("appends new rows, rewrites a changed tail and resets when rows disappear", () => {
  const surface = createSurface();
  const write = vi
    .spyOn(surface.terminal, "write")
    .mockImplementation((_, callback) => {
      callback?.();
    });
  const bottom = vi
    .spyOn(surface.terminal, "scrollToBottom")
    .mockImplementation(() => undefined);
  const { rerender } = renderHook(
    ({ rows }) => useTerminalText(surface, rows),
    {
      initialProps: { rows: { rows: ["one"], lineStarts: [0] } },
    },
  );
  expect(write).toHaveBeenLastCalledWith("one");
  rerender({ rows: { rows: ["one", "two"], lineStarts: [0, 1] } });
  expect(write).toHaveBeenLastCalledWith("\r\ntwo");
  rerender({ rows: { rows: ["one", "changed"], lineStarts: [0, 1] } });
  expect(write).toHaveBeenLastCalledWith(
    "\u001b[?2026h\r\u001b[Jchanged\u001b[?2026l",
  );
  rerender({ rows: { rows: ["one"], lineStarts: [0] } });
  expect(write.mock.calls.at(-1)?.[0]).toBe(
    "\u001bc\u001b[?2026h\u001b[?25lone\u001b[?2026l",
  );
  expect(bottom).toHaveBeenCalledOnce();
  surface.terminal.dispose();
});

it("measures available columns on resize and disposes the listener", () => {
  const surface = createSurface();
  const measure = vi
    .spyOn(surface.fit, "proposeDimensions")
    .mockReturnValue(undefined);
  let onResize = (): void => undefined;
  const dispose = vi.fn();
  const subscribe: Terminal["onResize"] = (listener) => {
    onResize = () => listener({ cols: 80, rows: 24 });
    return { dispose };
  };
  Object.defineProperty(surface.terminal, "onResize", { value: subscribe });
  const { result, unmount } = renderHook(() => useTerminalColumns(surface));
  expect(result.current).toBeNull();
  measure.mockReturnValue({ cols: 80, rows: 24 });
  act(() => onResize());
  expect(result.current).toBe(79);
  unmount();
  expect(dispose).toHaveBeenCalledOnce();
  surface.terminal.dispose();
});
