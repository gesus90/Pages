import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ToolMark,
  hasToolMark,
} from "@/app/components/agents/model-picker/tool-mark";

describe("hasToolMark", () => {
  it("knows the vendor icons of the listed tools", () => {
    for (const mark of [
      "claude",
      "openai",
      "antigravity",
      "opencode",
      "openrouter",
      "zai",
    ])
      expect(hasToolMark(mark)).toBe(true);
  });

  it("does not take inherited object keys for a mark", () => {
    expect(hasToolMark("gemini")).toBe(false);
    expect(hasToolMark("toString")).toBe(false);
  });
});

describe("ToolMark", () => {
  it("shows the vendor icon in a tile hidden from assistive technology", () => {
    const { container } = render(<ToolMark mark="claude" className="extra" />);
    const tile = container.firstElementChild;
    const image = container.querySelector("img");

    expect(tile?.getAttribute("aria-hidden")).toBe("true");
    expect(tile?.className).toContain("extra");
    expect(tile?.className).toContain("size-5");
    expect(image?.getAttribute("src")).toContain("claude");
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("gives an icon without a tile of its own the vendor's white tile and scaling", () => {
    const { container } = render(<ToolMark mark="antigravity" />);

    expect(container.firstElementChild?.className).toContain("bg-white");
    expect(container.querySelector("img")?.className).toContain("scale-[1.7]");
  });

  it("shows the neutral mark for a tool without an icon", () => {
    const { container } = render(
      <ToolMark mark="simulation" className="extra" />,
    );
    const tile = container.firstElementChild;

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(tile?.getAttribute("aria-hidden")).toBe("true");
    expect(tile?.className).toContain("bg-muted");
    expect(tile?.className).toContain("extra");
  });
});
