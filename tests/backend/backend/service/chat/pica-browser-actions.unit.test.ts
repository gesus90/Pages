import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaBrowserSession } from "@/backend/service/chat/browser/PicaBrowserSession";

const settle = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/chat/browser/PicaBrowserObservation", () => ({
  settlePage: settle,
}));

import {
  click,
  drag,
  hover,
  labelOf,
  locateElement,
  press,
  resolvePlace,
  scroll,
} from "@/backend/service/chat/browser/PicaBrowserActions";

const mouse = {
  click: vi.fn(),
  move: vi.fn(),
  wheel: vi.fn(),
  down: vi.fn(),
  up: vi.fn(),
};
const keyboard = { press: vi.fn() };
const element = {
  scrollIntoViewIfNeeded: vi.fn(),
  boundingBox: vi.fn(),
  click: vi.fn(),
  dblclick: vi.fn(),
  evaluate: vi.fn(),
};
const handle = { asElement: vi.fn(), dispose: vi.fn() };
const page = {
  mouse,
  keyboard,
  evaluateHandle: vi.fn(),
  evaluate: vi.fn(),
  viewportSize: () => ({ width: 800, height: 600 }),
  waitForTimeout: vi.fn(),
};
const session = partial<PicaBrowserSession>({
  id: "browser",
  referenceKey: "key",
  elementNames: new Map([["e1", "button"]]),
  activePage: () => page,
  dialogAnswer: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  handle.asElement.mockReturnValue(element);
  page.evaluateHandle.mockResolvedValue(handle);
  page.evaluate.mockResolvedValue(false);
  element.boundingBox.mockResolvedValue({
    x: 10,
    y: 20,
    width: 40,
    height: 20,
  });
});

it("resolves live references and rejects stale or unpositioned elements", async () => {
  expect(labelOf(session, "e1")).toBe("e1 (button)");
  expect(await resolvePlace(session, { ref: "e1" })).toEqual({
    x: 30,
    y: 30,
    element,
  });
  expect(await resolvePlace(session, { x: 5, y: 6 })).toEqual({
    x: 5,
    y: 6,
    element: null,
  });
  await expect(resolvePlace(session, {})).rejects.toThrow();
  element.boundingBox.mockResolvedValueOnce(null);
  await expect(resolvePlace(session, { ref: "e1" })).rejects.toThrow();
  handle.asElement.mockReturnValueOnce(null);
  await expect(locateElement(session, "stale")).rejects.toThrow();
  expect(handle.dispose).toHaveBeenCalledOnce();
});

it("clicks references or coordinates and clears dialog answers", async () => {
  expect(
    await click(session, {
      browserId: "browser",
      ref: "e1",
      double: true,
      dialog: "accept",
    }),
  ).toContain("Double-clicked");
  expect(element.dblclick).toHaveBeenCalledOnce();
  expect(session.dialogAnswer).toBeNull();
  await click(session, { browserId: "browser", x: 5, y: 6 });
  expect(mouse.click).toHaveBeenCalledWith(5, 6, {
    button: "left",
    clickCount: 1,
  });
});

it("blocks character keys in secret fields and permits navigation keys", async () => {
  page.evaluate.mockResolvedValue(true);
  await expect(
    press(session, { browserId: "browser", keys: "a" }),
  ).rejects.toThrow();
  expect(keyboard.press).not.toHaveBeenCalled();
  await press(session, { browserId: "browser", keys: "Enter" });
  expect(keyboard.press).toHaveBeenCalledWith("Enter");
});

it("scrolls, hovers and drags using a simulated page", async () => {
  await scroll(session, { browserId: "browser", direction: "down" });
  expect(mouse.wheel).toHaveBeenCalledWith(0, 600);
  await scroll(session, {
    browserId: "browser",
    direction: "left",
    amount: 50,
    ref: "e1",
  });
  expect(element.evaluate).toHaveBeenCalledWith(expect.any(Function), {
    deltaX: -50,
    deltaY: 0,
  });
  await hover(session, { x: 1, y: 2 });
  await drag(session, {
    browserId: "browser",
    from: { x: 1, y: 2 },
    to: { x: 3, y: 4 },
  });
  expect(mouse.down).toHaveBeenCalledOnce();
  expect(mouse.up).toHaveBeenCalledOnce();
});
