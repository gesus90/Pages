// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

describe("createI18n", () => {
  it("translates the German login screen", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    expect(i18n.t("login.title")).toBe("Willkommen zurück");
    expect(i18n.t("login.username")).toBe("Benutzername");
    expect(i18n.t("account.signOut")).toBe("Logout");
  });

  it("translates the English login screen", () => {
    const i18n = createI18n(LANGUAGE.ENGLISH);

    expect(i18n.t("login.title")).toBe("Welcome back");
    expect(i18n.t("login.username")).toBe("Username");
    expect(i18n.t("account.signOut")).toBe("Log out");
  });

  it("interpolates dashboard names", () => {
    const german = createI18n(LANGUAGE.GERMAN);
    const english = createI18n(LANGUAGE.ENGLISH);

    expect(german.t("dashboard.greeting.morning", { name: "Admin" })).toContain(
      "Admin",
    );
    expect(
      english.t("dashboard.greeting.evening", { name: "Müller" }),
    ).toContain("Müller");
  });

  it("creates isolated instances per call", () => {
    const german = createI18n(LANGUAGE.GERMAN);
    const english = createI18n(LANGUAGE.ENGLISH);

    expect(german.t("login.title")).not.toBe(english.t("login.title"));
  });
});
