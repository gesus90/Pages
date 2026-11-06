import { expect, it } from "vitest";

import { clientLoader } from "@/app/routes/settings-index";

it("sends the settings root to the personal profile", () => {
  const response = clientLoader();
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/settings/profile");
});
