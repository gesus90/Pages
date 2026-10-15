import { describe, expect, it } from "vitest";

import {
  readOptionalText,
  readRequiredText,
  readText,
  readTextOrEmpty,
  readTrimmedText,
} from "@/app/lib/form-fields.server";

function formWith(fields: Record<string, string | File>): FormData {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }

  return form;
}

const UPLOAD = new File(["content"], "note.txt", { type: "text/plain" });

describe("form field readers", () => {
  it("reads text, keeps empty text and refuses a file", () => {
    const form = formWith({ filled: "value", empty: "", upload: UPLOAD });

    expect(readText(form, "filled")).toBe("value");
    expect(readText(form, "empty")).toBe("");
    expect(readText(form, "upload")).toBeNull();
    expect(readText(form, "missing")).toBeNull();
  });

  it("treats empty text as missing for required and optional fields", () => {
    const form = formWith({ filled: " value ", empty: "", upload: UPLOAD });

    for (const read of [readRequiredText, readOptionalText]) {
      expect(read(form, "filled")).toBe(" value ");
      expect(read(form, "empty")).toBeNull();
      expect(read(form, "upload")).toBeNull();
      expect(read(form, "missing")).toBeNull();
    }
  });

  it("defaults to an empty string", () => {
    const form = formWith({ filled: "value", upload: UPLOAD });

    expect(readTextOrEmpty(form, "filled")).toBe("value");
    expect(readTextOrEmpty(form, "upload")).toBe("");
    expect(readTextOrEmpty(form, "missing")).toBe("");
  });

  it("trims blanks and reports blank-only text as missing", () => {
    const form = formWith({
      padded: "  value\t",
      blank: " \n ",
      upload: UPLOAD,
    });

    expect(readTrimmedText(form, "padded")).toBe("value");
    expect(readTrimmedText(form, "blank")).toBeNull();
    expect(readTrimmedText(form, "upload")).toBeNull();
    expect(readTrimmedText(form, "missing")).toBeNull();
  });
});
