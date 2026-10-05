import { describe, expect, it } from "vitest";

import { validateMilestoneInput } from "@/backend/service/MilestoneValidation";
import { isMilestoneStatus } from "@/definition/Task";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

describe("validateMilestoneInput", () => {
  it("trims the name and turns missing values into null", () => {
    expect(validateMilestoneInput({ name: "  Beta  " })).toEqual({
      colorCustom: null,
      colorKey: null,
      dueAt: null,
      iconKey: null,
      name: "Beta",
      startAt: null,
    });
  });

  it("keeps valid dates, colors and icons", () => {
    expect(
      validateMilestoneInput({
        colorCustom: "#AbCdEf",
        colorKey: "release",
        dueAt: " 2026-10-01 ",
        iconKey: "rocket",
        name: "Beta",
        startAt: "2026-09-01",
      }),
    ).toEqual({
      colorCustom: "#AbCdEf",
      colorKey: "release",
      dueAt: "2026-10-01",
      iconKey: "rocket",
      name: "Beta",
      startAt: "2026-09-01",
    });
  });

  it("treats blank and null dates as missing", () => {
    expect(
      validateMilestoneInput({ dueAt: "  ", name: "Beta", startAt: null }),
    ).toMatchObject({ dueAt: null, startAt: null });
  });

  it("accepts a milestone that starts and ends on the same day", () => {
    expect(
      validateMilestoneInput({
        dueAt: "2026-09-01",
        name: "Beta",
        startAt: "2026-09-01",
      }),
    ).toMatchObject({ dueAt: "2026-09-01" });
  });

  it.each([
    ["an empty name", { name: "   " }, "between 1 and 200"],
    ["a long name", { name: "n".repeat(201) }, "between 1 and 200"],
    [
      "a malformed start date",
      { name: "B", startAt: "1.9.2026" },
      "start date must use",
    ],
    [
      "a malformed due date",
      { dueAt: "2026-9-1", name: "B" },
      "due date must use",
    ],
    [
      "a start after the due date",
      { dueAt: "2026-09-01", name: "B", startAt: "2026-09-02" },
      "must not be after",
    ],
    ["an unknown color", { colorKey: "neon", name: "B" }, "supported color"],
    ["an unknown icon", { iconKey: "teapot", name: "B" }, "supported symbol"],
    ["a short custom color", { colorCustom: "#abc", name: "B" }, "#RRGGBB"],
  ])("rejects %s", (_label, input, message) => {
    expect(() =>
      validateMilestoneInput(
        input as Parameters<typeof validateMilestoneInput>[0],
      ),
    ).toThrow(WorkItemValidationError);
    expect(() =>
      validateMilestoneInput(
        input as Parameters<typeof validateMilestoneInput>[0],
      ),
    ).toThrow(message);
  });
});

describe("isMilestoneStatus", () => {
  it.each(["open", "completed", "archived"])("accepts %s", (value) => {
    expect(isMilestoneStatus(value)).toBe(true);
  });

  it.each(["done", "", null, undefined, 1])("rejects %j", (value) => {
    expect(isMilestoneStatus(value)).toBe(false);
  });
});
