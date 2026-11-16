import { describe, expect, it, vi } from "vitest";

import { PicaAdminBrowser } from "@/backend/service/chat/admin/PicaAdminBrowser";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  publicUrl: vi.fn(),
  readPage: vi.fn(),
}));
vi.mock("@/backend/service/chat/admin/PicaBrowserSandbox", () => ({
  launchPicaBrowser: mocks.launch,
}));
vi.mock("@/backend/service/chat/admin/PicaBrowserNetwork", () => ({
  publicBrowserUrl: mocks.publicUrl,
  readPublicPage: mocks.readPage,
}));
vi.mock("@/backend/service/chat/admin/PicaAdminFiles", () => ({
  adminScope: () => "scope",
}));

function fixture(): {
  service: PicaAdminBrowser;
  context: RuntimeExecutionContext;
  browser: { close: ReturnType<typeof vi.fn> };
  locator: {
    count: ReturnType<typeof vi.fn>;
    getAttribute: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
  };
} {
  const locator = {
    count: vi.fn().mockResolvedValue(1),
    getAttribute: vi.fn().mockResolvedValue("text"),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    innerText: vi.fn().mockResolvedValue("safe content"),
  };
  const page = {
    on: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Title"),
    locator: vi.fn().mockReturnValue(locator),
  };
  const isolated = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    routeWebSocket: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    on: vi.fn(),
  };
  const browser = {
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(isolated),
  };
  mocks.launch.mockResolvedValue(browser);
  mocks.publicUrl.mockImplementation((url: string) => new URL(url));
  return {
    service: new PicaAdminBrowser(),
    context: partial<RuntimeExecutionContext>({
      signal: new AbortController().signal,
      authorize: vi.fn().mockResolvedValue(undefined),
    }),
    browser,
    locator,
  };
}

async function open(
  service: PicaAdminBrowser,
  context: RuntimeExecutionContext,
): Promise<string> {
  const result = await service.open(
    context,
    { task: "Review", url: "https://example.test/", file: null },
    null,
  );
  if (
    typeof result !== "object" ||
    result === null ||
    !("browserId" in result) ||
    typeof result.browserId !== "string"
  )
    throw new Error("Missing browser identifier");
  return result.browserId;
}

describe("isolated administrator browser", () => {
  it("opens, views, clicks and closes a scoped session", async () => {
    const { service, context, browser, locator } = fixture();
    const browserId = await open(service, context);
    await expect(
      service.action(context, {
        browserId,
        action: "view",
        selector: null,
        text: null,
      }),
    ).resolves.toMatchObject({ title: "Title", content: "safe content" });
    await service.action(context, {
      browserId,
      action: "click",
      selector: "button",
      text: null,
    });
    expect(locator.click).toHaveBeenCalledOnce();
    await expect(
      service.action(context, {
        browserId,
        action: "close",
        selector: null,
        text: null,
      }),
    ).resolves.toMatchObject({ status: "closed" });
    expect(browser.close).toHaveBeenCalledOnce();
    await expect(
      service.action(context, {
        browserId,
        action: "view",
        selector: null,
        text: null,
      }),
    ).rejects.toThrow();
  });

  it("refuses ambiguous targets, selectors and password fields", async () => {
    const { service, context, locator } = fixture();
    await expect(
      service.open(context, { task: "x", url: null, file: null }, null),
    ).rejects.toThrow();
    const browserId = await open(service, context);
    await expect(
      service.action(context, {
        browserId,
        action: "click",
        selector: null,
        text: null,
      }),
    ).rejects.toThrow();
    locator.count.mockResolvedValueOnce(2);
    await expect(
      service.action(context, {
        browserId,
        action: "click",
        selector: "button",
        text: null,
      }),
    ).rejects.toThrow();
    locator.getAttribute.mockResolvedValueOnce("password");
    await expect(
      service.action(context, {
        browserId,
        action: "fill",
        selector: "input",
        text: "secret",
      }),
    ).rejects.toThrow();
    await service.action(context, {
      browserId,
      action: "fill",
      selector: "input",
      text: "safe",
    });
    expect(locator.fill).toHaveBeenCalledWith("safe");
  });

  it("enforces the session limit and closes a scope", async () => {
    const { service, context, browser } = fixture();
    for (let index = 0; index < 4; index += 1) await open(service, context);
    await expect(open(service, context)).rejects.toThrow();
    await service.closeScope(context);
    expect(browser.close).toHaveBeenCalledTimes(4);
  });
});
