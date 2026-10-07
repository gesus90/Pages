import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";

import { createUser } from "../helpers/factories";

import type { User } from "@/definition/User";

function createArguments(
  user: User | null,
  method = "POST",
): Parameters<typeof readSettingsRequest>[0] {
  const context = new RouterContextProvider();

  context.set(authenticatedUserContext, user);

  return {
    context,
    request: new Request("http://pages.invalid/settings/profile", {
      body: method === "POST" ? new URLSearchParams({ intent: "x" }) : null,
      method,
    }),
  };
}

describe("readSettingsRequest", () => {
  beforeEach(() => {
    vi.mocked(getApplicationServices).mockResolvedValue(
      {} as Awaited<ReturnType<typeof getApplicationServices>>,
    );
  });

  it("gathers user, form fields and services of a submission", async () => {
    const user = createUser();
    const result = await readSettingsRequest(createArguments(user));

    expect(result.user).toBe(user);
    expect(result.formData.get("intent")).toBe("x");
    expect(result.services).toEqual({});
  });

  it("rejects anything but a POST with 405", async () => {
    const failure = await readSettingsRequest(
      createArguments(createUser(), "PUT"),
    ).catch((error: unknown) => error);

    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("POST");
  });

  it("rejects a visitor without a user with 403", async () => {
    const failure = await readSettingsRequest(createArguments(null)).catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(403);
  });
});
