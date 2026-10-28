import { expect, it } from "vitest";

import { readSetupForm } from "@/app/lib/setup/setup-form.server";

function formOf(fields: Readonly<Record<string, string | File>>): FormData {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }

  return form;
}

const VALID = {
  companyName: "  Synthetic Ltd  ",
  username: " admin ",
  password: " long secret ",
  email: " admin@example.invalid ",
  databasePath: " /data/pages.duckdb ",
};

it("trims the text fields and keeps password and path as entered", () => {
  expect(readSetupForm(formOf(VALID))).toEqual({
    isValid: true,
    input: {
      companyName: "Synthetic Ltd",
      username: "admin",
      password: " long secret ",
      email: "admin@example.invalid",
      databasePath: " /data/pages.duckdb ",
    },
  });
});

it("stores no email and an empty path when both are left out", () => {
  const fields = {
    companyName: VALID.companyName,
    username: VALID.username,
    password: VALID.password,
    email: "  ",
  };

  expect(readSetupForm(formOf(fields))).toMatchObject({
    isValid: true,
    input: { email: null, databasePath: "" },
  });
});

it("reports the error of every rejected field at once", () => {
  expect(
    readSetupForm(
      formOf({ password: "short", email: "no-address", databasePath: "x" }),
    ),
  ).toEqual({
    isValid: false,
    fieldErrors: {
      companyName: "required",
      username: "required",
      password: "tooShort",
      email: "invalidEmail",
    },
  });
});

it("reads a file in a text field like a missing value", () => {
  expect(
    readSetupForm(
      formOf({ ...VALID, companyName: new File(["Synthetic"], "name.txt") }),
    ),
  ).toEqual({ isValid: false, fieldErrors: { companyName: "required" } });
});

it("requires a password even when the form leaves out password and email", () => {
  expect(
    readSetupForm(
      formOf({ companyName: VALID.companyName, username: VALID.username }),
    ),
  ).toEqual({ isValid: false, fieldErrors: { password: "required" } });
});
