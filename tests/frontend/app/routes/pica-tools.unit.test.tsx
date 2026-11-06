import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import PicaToolsRoute from "@/app/routes/pica-tools";
import { loader as dataLoader } from "@/app/routes/pica-tools-data";
import { loader } from "@/app/routes/pica-tools-server";

import {
  ACTOR,
  i18n,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

const requireAdministrator = vi.hoisted(() => vi.fn());

const AUDIENCE = vi.hoisted(() => ({
  userId: "user-1",
  authorizationVersion: "account:pica:1",
}));

vi.mock("@/app/lib/local-state/local-state-audience.server", () => ({
  readLocalStateAudience: async (): Promise<unknown> => AUDIENCE,
  readAuthorizationVersion: async (): Promise<string> =>
    AUDIENCE.authorizationVersion,
}));
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
  ).resolves.toEqual({ isAllowed: true, audience: AUDIENCE });
  expect(requireAdministrator).toHaveBeenCalledWith("user-1");
});

it("refuses an account whose administrator right is gone", async () => {
  requireAdministrator.mockRejectedValue(new Error("denied"));

  await expect(
    loader(routeArguments(pagesRequest("/pica-tools"), { user: ACTOR })),
  ).resolves.toEqual({ isAllowed: false });
});

it("keeps the page out of caches", async () => {
  const response = await dataLoader(
    routeArguments(pagesRequest("/pica-tools-api/access"), { user: ACTOR }),
  );

  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("shows the panel to administrators", () => {
  renderRoute(PicaToolsRoute, {
    loaderData: { isAllowed: true, audience: AUDIENCE },
  });

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
