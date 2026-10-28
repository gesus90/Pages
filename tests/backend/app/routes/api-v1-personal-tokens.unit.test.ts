import { expect, it } from "vitest";

import { action, loader } from "@/app/routes/api-v1-personal-tokens";

it.each([
  ["read", loader],
  ["write", action],
])(
  "answers every %s of the removed API with not found",
  async (caseName, handler) => {
    const response = handler();

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "not_found" });
  },
);
