import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/language.server", () => ({
  languageCookie: {
    parse: vi.fn(),
    serialize: vi.fn(),
  },
  resolveAnonymousLanguage: vi.fn(),
}));

import { languageCookie } from "@/app/lib/language.server";
import { action } from "@/app/routes/set-language";

const mockedSerialize = vi.mocked(languageCookie.serialize);

function createPostRequest(entries: Record<string, string>): Request {
  return new Request("http://pages.invalid/set-language", {
    body: new URLSearchParams(entries),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

describe("set-language route action", () => {
  beforeEach(() => {
    mockedSerialize.mockReset();
  });

  it("rejects non-POST requests", async () => {
    const failure = await action({
      params: {},
      request: new Request("http://pages.invalid/set-language"),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("POST");
  });

  it("rejects unsupported languages", async () => {
    const failure = await action({
      params: {},
      request: createPostRequest({ language: "fr", redirectTo: "/login" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(400);
    expect(mockedSerialize).not.toHaveBeenCalled();
  });

  it("rejects missing language selections", async () => {
    const failure = await action({
      params: {},
      request: createPostRequest({ redirectTo: "/login" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(400);
  });

  it("persists German and returns to the login screen", async () => {
    mockedSerialize.mockResolvedValue("pages_language=de; Path=/");

    const response = await action({
      params: {},
      request: createPostRequest({ language: "de", redirectTo: "/login" }),
    } as unknown as Parameters<typeof action>[0]);

    expect(mockedSerialize).toHaveBeenCalledWith("de");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("pages_language=de");
  });

  it("persists English and returns to the requested page", async () => {
    mockedSerialize.mockResolvedValue("pages_language=en; Path=/");

    const response = await action({
      params: {},
      request: createPostRequest({ language: "en", redirectTo: "/dashboard" }),
    } as unknown as Parameters<typeof action>[0]);

    expect(response.headers.get("Location")).toBe("/dashboard");
  });

  it("falls back to the start page for external redirect targets", async () => {
    mockedSerialize.mockResolvedValue("pages_language=de; Path=/");

    const response = await action({
      params: {},
      request: createPostRequest({
        language: "de",
        redirectTo: "https://pages.invalid/elsewhere",
      }),
    } as unknown as Parameters<typeof action>[0]);

    expect(response.headers.get("Location")).toBe("/");
  });

  it("falls back to the start page without a redirect target", async () => {
    mockedSerialize.mockResolvedValue("pages_language=en; Path=/");

    const response = await action({
      params: {},
      request: createPostRequest({ language: "en" }),
    } as unknown as Parameters<typeof action>[0]);

    expect(response.headers.get("Location")).toBe("/");
  });
});
