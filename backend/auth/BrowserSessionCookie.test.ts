import { expect, it, vi } from "vitest";

import { browserSessionCookie } from "./BrowserSessionCookie";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const TWO_WEEKS_IN_SECONDS = 14 * 24 * 60 * 60;

it("names the session cookie and limits it to the browser path with its lifetime", async () => {
  const header = await browserSessionCookie.serialize("session-token");

  expect(header).toMatch(/^pages_session=/u);
  expect(header).toContain(`Max-Age=${TWO_WEEKS_IN_SECONDS}`);
  expect(header).toContain("Path=/");
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Lax");
});

it("reads back the token it wrote and reports a missing cookie as empty", async () => {
  const header = await browserSessionCookie.serialize("session-token");
  const cookieValue = header.split(";")[0];

  expect(await browserSessionCookie.parse(cookieValue)).toBe("session-token");
  expect(await browserSessionCookie.parse(null)).toBeNull();
});
