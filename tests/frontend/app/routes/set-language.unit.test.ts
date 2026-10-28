import { expect, it, vi } from "vitest";

import { languageCookie } from "@/app/lib/language.server";
import { action } from "@/app/routes/set-language";

import {
  formPost,
  pagesRequest,
  responseOf,
  routeArguments,
} from "./route-fixture";

// The fixture reads the user context of the authentication module.
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/app/lib/cookie-security.server", () => ({
  resolveCookieSecure: (): boolean => false,
}));

it("accepts only posts", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/set-language"))),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses a language Pages does not offer", async () => {
  const response = await responseOf(
    action(routeArguments(formPost("/set-language", { language: "fr" }))),
  );

  expect(response.status).toBe(400);
});

it("stores the language and returns to the local page", async () => {
  const response = await responseOf(
    action(
      routeArguments(
        formPost("/set-language", { language: "en", redirectTo: "/login" }),
      ),
    ),
  );

  expect(response.headers.get("Location")).toBe("/login");
  await expect(
    languageCookie.parse(response.headers.get("Set-Cookie")),
  ).resolves.toBe("en");
});
