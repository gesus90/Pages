import { expect, it } from "vitest";

import {
  isPlanReturn,
  planPortCentre,
  planReturnPath,
  planRoundedPath,
} from "@/app/components/agents/plans/plan-flow-route";

it("rounds every inner corner of a line and keeps both ends where they are", () => {
  const path = planRoundedPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    10,
  );

  expect(path).toBe("M0,0 L90,0 Q100,0 100,10 L100,100");
});

it("never rounds more than half of a short segment", () => {
  const path = planRoundedPath(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 100 },
    ],
    40,
  );

  expect(path).toBe("M0,0 L5,0 Q10,0 10,40 L10,100");
});

it("draws nothing for no points", () => {
  expect(planRoundedPath([], 10)).toBe("");
});

it("treats a target left of its source as a way back", () => {
  const route = {
    sourceX: 800,
    sourceY: 300,
    targetX: 200,
    targetY: 100,
    bottom: 640,
  };

  expect(isPlanReturn(route)).toBe(true);
  expect(isPlanReturn({ ...route, targetX: 1200 })).toBe(false);
  expect(isPlanReturn({ ...route, targetX: 860 })).toBe(true);
});

it("runs a way back out to the right, below both cards and into the target from the left", () => {
  const [path, labelX, labelY] = planReturnPath({
    sourceX: 800,
    sourceY: 300,
    targetX: 200,
    targetY: 100,
    bottom: 640,
  });

  // The ends are exactly the handle centres.
  expect(path.startsWith("M800,300 ")).toBe(true);
  expect(path.endsWith(" L200,100")).toBe(true);
  expect(path).not.toContain("C");
  // The lowest run lies 40 below the lowest card; its label sits in the middle of it.
  expect(labelY).toBe(680);
  expect(labelX).toBe(500);
});

it("keeps a way back below its ports when the cards are not measured yet", () => {
  const [, , labelY] = planReturnPath({
    sourceX: 400,
    sourceY: 120,
    targetX: 100,
    targetY: 300,
    bottom: 0,
  });

  expect(labelY).toBe(340);
});

const CARD = {
  internals: {
    positionAbsolute: { x: 100, y: 40 },
    handleBounds: {
      source: [{ id: "flow-out", x: 314, y: 20, width: 12, height: 12 }],
      target: [{ id: "flow-in", x: -6, y: 26, width: 12, height: 12 }],
    },
  },
};

it("finds the centre of a port from the position of its card and the size React Flow measured", () => {
  expect(planPortCentre(CARD, "source", "flow-out")).toEqual({ x: 420, y: 66 });
  expect(planPortCentre(CARD, "target", "flow-in")).toEqual({ x: 100, y: 72 });
});

it("names no centre while the card or the port is not measured", () => {
  expect(planPortCentre(undefined, "source", "flow-out")).toBeNull();
  expect(
    planPortCentre(
      { internals: { positionAbsolute: { x: 0, y: 0 } } },
      "source",
      "flow-out",
    ),
  ).toBeNull();
  expect(planPortCentre(CARD, "source", "missing")).toBeNull();
  expect(planPortCentre(CARD, "target", "flow-out")).toBeNull();
});
