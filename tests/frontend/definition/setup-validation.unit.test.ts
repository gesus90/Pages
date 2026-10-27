import { describe, expect, it } from "vitest";

import {
  MAXIMUM_COMPANY_NAME_LENGTH,
  MAXIMUM_EMAIL_LENGTH,
  MAXIMUM_PASSWORD_LENGTH,
  MAXIMUM_USERNAME_LENGTH,
  validateSetupFields,
} from "@/definition/Setup";

import type { SetupFieldValues } from "@/definition/Setup";

const valid: SetupFieldValues = {
  companyName: "Example Company",
  username: "admin",
  password: "long-enough-password",
  email: "admin@example.com",
};

function validate(
  overrides: Partial<SetupFieldValues>,
): ReturnType<typeof validateSetupFields> {
  return validateSetupFields({ ...valid, ...overrides });
}

describe("validateSetupFields", () => {
  it("accepts complete valid values and an omitted email address", () => {
    expect(validateSetupFields(valid)).toEqual({});
    expect(validate({ email: "   " })).toEqual({});
  });

  it("requires company name and username, ignoring surrounding blanks", () => {
    expect(validate({ companyName: "   ", username: "" })).toEqual({
      companyName: "required",
      username: "required",
    });
  });

  it("limits company name and username after trimming", () => {
    expect(
      validate({
        companyName: `${"a".repeat(MAXIMUM_COMPANY_NAME_LENGTH)} `,
        username: "b".repeat(MAXIMUM_USERNAME_LENGTH),
      }),
    ).toEqual({});
    expect(
      validate({
        companyName: "a".repeat(MAXIMUM_COMPANY_NAME_LENGTH + 1),
        username: "b".repeat(MAXIMUM_USERNAME_LENGTH + 1),
      }),
    ).toEqual({ companyName: "tooLong", username: "tooLong" });
  });

  it.each([
    ["", "required"],
    ["short", "tooShort"],
    ["1234567", "tooShort"],
    ["12345678", null],
    ["a".repeat(MAXIMUM_PASSWORD_LENGTH), null],
    ["a".repeat(MAXIMUM_PASSWORD_LENGTH + 1), "tooLong"],
  ])("rates the password %j as %s", (password, expected) => {
    expect(validate({ password }).password ?? null).toBe(expected);
  });

  it("counts blanks inside a password and does not trim it", () => {
    expect(validate({ password: "        " })).toEqual({});
  });

  it.each([
    ["no-at-sign", "invalidEmail"],
    ["a@b", "invalidEmail"],
    ["a b@example.com", "invalidEmail"],
    [`${"a".repeat(MAXIMUM_EMAIL_LENGTH)}@example.com`, "invalidEmail"],
    [" admin@example.com ", null],
  ])("rates the email %j as %s", (email, expected) => {
    expect(validate({ email }).email ?? null).toBe(expected);
  });
});
