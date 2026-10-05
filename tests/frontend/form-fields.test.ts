import { describe, expect, it } from "vitest";

import {
  readOptionalText,
  readRequiredText,
  readText,
  readTextOrEmpty,
} from "@/app/lib/form-fields.server";

function createForm(entries: Record<string, string | File>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return formData;
}

const FORM = createForm({
  empty: "",
  file: new File(["x"], "x.txt"),
  title: "Release",
});

describe("form field readers", () => {
  describe("readText", () => {
    it("accepts text, including empty text", () => {
      expect(readText(FORM, "title")).toBe("Release");
      expect(readText(FORM, "empty")).toBe("");
    });

    it("rejects missing fields and files", () => {
      expect(readText(FORM, "missing")).toBeNull();
      expect(readText(FORM, "file")).toBeNull();
    });
  });

  describe("readRequiredText", () => {
    it("accepts non-empty text only", () => {
      expect(readRequiredText(FORM, "title")).toBe("Release");
      expect(readRequiredText(FORM, "empty")).toBeNull();
      expect(readRequiredText(FORM, "missing")).toBeNull();
      expect(readRequiredText(FORM, "file")).toBeNull();
    });
  });

  describe("readOptionalText", () => {
    it("treats missing and empty fields as no value", () => {
      expect(readOptionalText(FORM, "title")).toBe("Release");
      expect(readOptionalText(FORM, "empty")).toBeNull();
      expect(readOptionalText(FORM, "missing")).toBeNull();
    });
  });

  describe("readTextOrEmpty", () => {
    it("defaults to an empty string", () => {
      expect(readTextOrEmpty(FORM, "title")).toBe("Release");
      expect(readTextOrEmpty(FORM, "empty")).toBe("");
      expect(readTextOrEmpty(FORM, "missing")).toBe("");
    });
  });
});
