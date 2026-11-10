import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlanNodeIcon } from "@/app/components/agents/plans/plan-node-icon";

function iconOf(container: HTMLElement): Element {
  const icon = container.querySelector("svg");
  if (!icon) throw new Error("No icon was drawn");
  return icon;
}

describe("the symbol of a node type", () => {
  it("is drawn at the standard size and hidden from assistive technology", () => {
    const { container } = render(<PlanNodeIcon type="agent" />);

    expect(iconOf(container).getAttribute("aria-hidden")).toBe("true");
    expect(iconOf(container).classList.contains("size-4")).toBe(true);
  });

  it("takes the class of the caller instead of the standard size", () => {
    const { container } = render(
      <PlanNodeIcon type="decision" className="size-6 text-plan-logic" />,
    );

    expect(iconOf(container).classList.contains("size-6")).toBe(true);
    expect(iconOf(container).classList.contains("size-4")).toBe(false);
  });

  it("differs between the types of nodes", () => {
    const types = [
      "agent",
      "group",
      "loop",
      "decision",
      "stack",
      "start",
      "end",
    ] as const;
    const drawings = types.map((type) => {
      const { container, unmount } = render(<PlanNodeIcon type={type} />);
      const markup = iconOf(container).innerHTML;
      unmount();
      return markup;
    });

    expect(new Set(drawings).size).toBe(types.length);
  });
});
