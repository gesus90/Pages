import { expect, it } from "vitest";

import {
  readSetupRejection,
  SETUP_FORM_FIELD,
} from "@/app/lib/setup/setup-action-data";

it("reports a refused token and a completed setup as rejections", () => {
  expect(
    readSetupRejection({ intent: "verify-token", error: "invalidToken" }),
  ).toBe("invalidToken");
  expect(
    readSetupRejection({ intent: "complete", error: "alreadyCompleted" }),
  ).toBe("alreadyCompleted");
});

it("does not reject the wizard for other errors or successful answers", () => {
  expect(readSetupRejection({ intent: "complete", error: "network" })).toBe(
    null,
  );
  expect(
    readSetupRejection({
      intent: "verify-token",
      access: { token: "token", suggestedDatabasePath: "/data/pages.db" },
    }),
  ).toBeNull();
});

it("names the form fields the wizard and the action share", () => {
  expect(SETUP_FORM_FIELD).toEqual({
    INTENT: "intent",
    TOKEN: "token",
    COMPANY_NAME: "companyName",
    USERNAME: "username",
    PASSWORD: "password",
    EMAIL: "email",
    DATABASE_PATH: "databasePath",
  });
});
