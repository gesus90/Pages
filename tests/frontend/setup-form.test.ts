import { describe, expect, it } from "vitest";

import { readSetupRejection } from "@/app/lib/setup/setup-action-data";
import { readSetupForm } from "@/app/lib/setup/setup-form.server";

function createForm(fields: Record<string, string>): FormData {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }

  return formData;
}

describe("readSetupForm", () => {
  it("returns the trimmed input of a valid setup", () => {
    expect(
      readSetupForm(
        createForm({
          companyName: " Pages GmbH ",
          databasePath: " /data/pages.duckdb ",
          email: " chef@example.com ",
          password: " geheimes Passwort ",
          username: " chef ",
        }),
      ),
    ).toEqual({
      input: {
        companyName: "Pages GmbH",
        databasePath: " /data/pages.duckdb ",
        email: "chef@example.com",
        password: " geheimes Passwort ",
        username: "chef",
      },
      isValid: true,
    });
  });

  it("treats a blank email as none", () => {
    const result = readSetupForm(
      createForm({
        companyName: "A",
        email: "  ",
        password: "12345678",
        username: "b",
      }),
    );

    expect(result).toMatchObject({ input: { databasePath: "", email: null } });
  });

  it("treats missing fields as empty", () => {
    expect(readSetupForm(new FormData())).toEqual({
      fieldErrors: {
        companyName: "required",
        password: "required",
        username: "required",
      },
      isValid: false,
    });
  });

  it("checks every field, also when fields are missing", () => {
    expect(readSetupForm(createForm({ email: "no-mail" }))).toEqual({
      fieldErrors: {
        companyName: "required",
        email: "invalidEmail",
        password: "required",
        username: "required",
      },
      isValid: false,
    });
  });
});

describe("readSetupRejection", () => {
  it("only reports refusals that stop the wizard", () => {
    expect(
      readSetupRejection({ error: "invalidToken", intent: "complete" }),
    ).toBe("invalidToken");
    expect(
      readSetupRejection({
        error: "alreadyCompleted",
        intent: "check-database-path",
      }),
    ).toBe("alreadyCompleted");
    expect(readSetupRejection({ error: "failed", intent: "complete" })).toBe(
      null,
    );
    expect(
      readSetupRejection({
        intent: "check-database-path",
        location: { input: "", status: "empty" },
      }),
    ).toBeNull();
  });
});
