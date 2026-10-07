import { describe, expect, it } from "vitest";

import {
  WORK_ITEM_ERROR_MESSAGES,
  WorkItemHierarchyError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import germanTranslation from "@/language/locales/de/translation.json";
import englishTranslation from "@/language/locales/en/translation.json";

import type { WorkItemErrorCode } from "@/backend/error/WorkItemErrors";

const CODES = Object.keys(WORK_ITEM_ERROR_MESSAGES) as WorkItemErrorCode[];

describe("work item errors", () => {
  it("carry the code the client translates and the English message for logs", () => {
    const validation = new WorkItemValidationError("labelNameTaken");
    const hierarchy = new WorkItemHierarchyError("epicSelfParent");

    expect(validation.code).toBe("labelNameTaken");
    expect(validation.message).toBe("A label with this name already exists.");
    expect(hierarchy.code).toBe("epicSelfParent");
    expect(hierarchy.message).toBe("An Epic cannot be its own parent.");
  });

  it.each(CODES)("translates %s in German and English", (code) => {
    const german: Record<string, string> = germanTranslation.tasks.error;
    const english: Record<string, string> = englishTranslation.tasks.error;

    expect(german[code]?.trim()).toBeTruthy();
    expect(english[code]?.trim()).toBeTruthy();
  });
});
