import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { usePlanPaletteView } from "@/app/components/agents/plans/use-plan-palette-view";

it("opens on the node list, toggles and switches tabs", () => {
  const { result } = renderHook(() => usePlanPaletteView());
  expect(result.current.isOpen).toBe(true);
  expect(result.current.tab).toBe("nodes");
  act(() => result.current.toggle());
  expect(result.current.isOpen).toBe(false);
  act(() => result.current.select("templates"));
  expect(result.current.tab).toBe("templates");
  expect(result.current.isOpen).toBe(false);
});

it("opens the palette on its templates after a save", () => {
  const { result } = renderHook(() => usePlanPaletteView());
  act(() => result.current.toggle());
  act(() => result.current.showTemplates());
  expect(result.current.isOpen).toBe(true);
  expect(result.current.tab).toBe("templates");
});
