import { expect, it } from "vitest";

import { loader } from "@/app/routes/favicon";

it("serves the project favicon as a cacheable SVG", async () => {
  const response = loader();
  expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.text()).toContain("<svg");
});
