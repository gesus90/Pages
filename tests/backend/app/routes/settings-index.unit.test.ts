import { expect, it } from "vitest";

import { loader } from "@/app/routes/settings-index";

it("sends the settings root to the personal profile", () => {
  const response = loader();
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/settings/profile");
});
