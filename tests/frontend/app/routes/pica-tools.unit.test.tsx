import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import PicaToolsRoute, { headers, loader } from "@/app/routes/pica-tools";

import {
  ACTOR,
  headerArguments,
  i18n,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

const requireAdministrator = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    picaAdminService: { requireAdministrator },
  }),
}));
vi.mock("@/app/components/chat/admin/pica-admin-panel", () => ({
  PicaAdminPanel: (): React.ReactElement => <p>admin panel</p>,
}));

beforeEach(() => {
  requireAdministrator.mockReset();
});

it("refuses the tools without a signed-in actor", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/pica-tools"), { user: null })),
  ).resolves.toEqual({ isAllowed: false });
  expect(requireAdministrator).not.toHaveBeenCalled();
});

it("allows a current administrator", async () => {
  requireAdministrator.mockResolvedValue(undefined);

  await expect(
    loader(routeArguments(pagesRequest("/pica-tools"), { user: ACTOR })),
  ).resolves.toEqual({ isAllowed: true });
  expect(requireAdministrator).toHaveBeenCalledWith("user-1");
});

it("refuses an account whose administrator right is gone", async () => {
  requireAdministrator.mockRejectedValue(new Error("denied"));

  await expect(
    loader(routeArguments(pagesRequest("/pica-tools"), { user: ACTOR })),
  ).resolves.toEqual({ isAllowed: false });
});

it("keeps the page out of caches", () => {
  expect(headers(headerArguments())).toBe(CHAT_NO_STORE);
});

it("shows the panel to administrators", () => {
  renderRoute(PicaToolsRoute, { loaderData: { isAllowed: true } });

  expect(screen.getByText("admin panel")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows a refusal to everybody else", () => {
  renderRoute(PicaToolsRoute, { loaderData: { isAllowed: false } });

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("picaAdmin.denied"),
  );
  expect(screen.queryByText("admin panel")).toBeNull();
});
