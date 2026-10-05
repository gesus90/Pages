import { describe, expect, it } from "vitest";

import {
  canUseDatabaseLocation,
  DATABASE_LOCATION_STATUS,
  validateSetupFields,
} from "@/definition/Setup";

const VALID = {
  companyName: "Pages GmbH",
  email: "",
  password: "12345678",
  username: "chef",
};

describe("canUseDatabaseLocation", () => {
  it("only continues with a free path or an existing Pages database", () => {
    expect(
      Object.values(DATABASE_LOCATION_STATUS).filter(canUseDatabaseLocation),
    ).toEqual(["existing", "available"]);
  });
});

describe("validateSetupFields", () => {
  it("accepts valid values with or without email", () => {
    expect(validateSetupFields(VALID)).toEqual({});
    expect(
      validateSetupFields({ ...VALID, email: " chef@example.com " }),
    ).toEqual({});
  });

  it("requires company name, username, and password", () => {
    expect(
      validateSetupFields({
        companyName: "  ",
        email: "",
        password: "",
        username: "",
      }),
    ).toEqual({
      companyName: "required",
      password: "required",
      username: "required",
    });
  });

  it("applies the lengths of the user directory", () => {
    expect(
      validateSetupFields({
        companyName: "c".repeat(201),
        email: `${"e".repeat(320)}@x.de`,
        password: "p".repeat(1001),
        username: "u".repeat(201),
      }),
    ).toEqual({
      companyName: "tooLong",
      email: "invalidEmail",
      password: "tooLong",
      username: "tooLong",
    });
    expect(validateSetupFields({ ...VALID, password: "1234567" })).toEqual({
      password: "tooShort",
    });
  });

  it("rejects malformed email addresses", () => {
    expect(validateSetupFields({ ...VALID, email: "chef@" })).toEqual({
      email: "invalidEmail",
    });
  });
});
