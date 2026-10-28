import { expect, it } from "vitest";

import { formatCounter } from "@/app/lib/project-format";

it("writes counters below one thousand unchanged", () => {
  expect(formatCounter(0)).toBe("0");
  expect(formatCounter(999)).toBe("999");
});

it("groups thousands with a dot and pads the remainder", () => {
  expect(formatCounter(1000)).toBe("1.000");
  expect(formatCounter(12045)).toBe("12.045");
});
