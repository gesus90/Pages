import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaBrowserSession } from "@/backend/service/chat/browser/PicaBrowserSession";

const helpers = vi.hoisted(() => ({
  locate: vi.fn(),
  label: vi.fn(),
  click: vi.fn(),
  settle: vi.fn(),
}));
vi.mock("@/backend/service/chat/browser/PicaBrowserActions", () => ({
  locateElement: helpers.locate,
  labelOf: helpers.label,
  click: helpers.click,
}));
vi.mock("@/backend/service/chat/browser/PicaBrowserObservation", () => ({
  settlePage: helpers.settle,
}));

import {
  fillForm,
  typeText,
  uploadFile,
} from "@/backend/service/chat/browser/PicaBrowserForms";

const press = vi.fn();
const type = vi.fn();
const evaluate = vi.fn();
const page = { keyboard: { press, type }, evaluate };
const session = partial<PicaBrowserSession>({
  id: "browser",
  activePage: () => page,
});
const element = {
  evaluate: vi.fn(),
  fill: vi.fn(),
  focus: vi.fn(),
  setChecked: vi.fn(),
  selectOption: vi.fn(),
  setInputFiles: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  helpers.locate.mockResolvedValue(element);
  helpers.label.mockReturnValue("field");
  element.evaluate.mockResolvedValue(false);
  evaluate.mockResolvedValue(false);
});

it("types into a referenced field or the focused field and optionally submits", async () => {
  expect(
    await typeText(session, {
      browserId: "browser",
      ref: "field",
      text: "hello",
      clear: true,
      submit: true,
    }),
  ).toContain('Typed "hello" into field');
  expect(element.fill).toHaveBeenCalledWith("hello", { timeout: 6000 });
  expect(press).toHaveBeenCalledWith("Enter");
  await typeText(session, {
    browserId: "browser",
    text: "more",
    clear: true,
    submit: false,
  });
  expect(press).toHaveBeenCalledWith("ControlOrMeta+A");
  expect(type).toHaveBeenCalledWith("more");
});

it("rejects a secret field and never types into it", async () => {
  element.evaluate.mockResolvedValue(true);
  await expect(
    typeText(session, {
      browserId: "browser",
      ref: "field",
      text: "hello",
      clear: true,
      submit: false,
    }),
  ).rejects.toThrow();
  expect(element.fill).not.toHaveBeenCalled();
  evaluate.mockResolvedValue(true);
  await expect(
    typeText(session, {
      browserId: "browser",
      text: "hello",
      clear: false,
      submit: false,
    }),
  ).rejects.toThrow();
  expect(type).not.toHaveBeenCalled();
});

it("fills checkbox and select fields, falling back from label to value", async () => {
  element.evaluate
    .mockResolvedValueOnce("checkbox")
    .mockResolvedValueOnce("select");
  element.selectOption
    .mockRejectedValueOnce(new Error("no label"))
    .mockResolvedValueOnce(undefined);
  expect(
    await fillForm(session, {
      browserId: "browser",
      fields: [
        { ref: "check", checked: false },
        { ref: "select", option: "value" },
      ],
      submit: "enter",
    }),
  ).toBe("Filled 2 field(s) and submitted");
  expect(element.setChecked).toHaveBeenCalledWith(false, { timeout: 5000 });
  expect(element.selectOption).toHaveBeenCalledWith(
    { value: "value" },
    { timeout: 5000 },
  );
  expect(press).toHaveBeenCalledWith("Enter");
});

it("requires upload for file fields and checks missing field values", async () => {
  for (const kind of ["file", "select", "text"]) {
    element.evaluate.mockResolvedValueOnce(kind);
    await expect(
      fillForm(session, { browserId: "browser", fields: [{ ref: "field" }] }),
    ).rejects.toThrow();
  }
});

it("uploads a chosen in-memory payload to a simulated file input", async () => {
  element.evaluate.mockResolvedValue("file");
  const file = {
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  };
  expect(await uploadFile(session, "field", file)).toBe(
    'Uploaded "note.txt" to field',
  );
  expect(element.setInputFiles).toHaveBeenCalledWith(file, { timeout: 6000 });
});
