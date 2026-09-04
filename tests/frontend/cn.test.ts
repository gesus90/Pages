import { describe, expect, it } from "vitest";

import { cn } from "@/app/lib/cn";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-4", "text-lg")).toBe("px-4 text-lg");
  });

  it("ignores falsy conditional values", () => {
    expect(cn("base", false && "hidden", undefined, null, "")).toBe("base");
  });

  it("merges conflicting Tailwind utilities", () => {
    expect(cn("px-4", "px-5")).toBe("px-5");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("supports object and array syntax", () => {
    expect(cn({ active: true, disabled: false }, ["extra"])).toBe(
      "active extra",
    );
  });

  it("returns an empty string without inputs", () => {
    expect(cn()).toBe("");
  });
});
