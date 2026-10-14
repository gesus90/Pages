import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AgentProfileRow } from "@/app/components/settings/agents/agent-profile-row";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentProfile } from "@/definition/AgentProfile";

const i18n = createI18n("de");
const PROFILE: AgentProfile = {
  id: "linked",
  name: "Synthetic linked agent",
  connectionId: "connection",
  model: "model",
  reasoningEffort: null,
  isActive: true,
  purposes: ["agent"],
  targets: [{ kind: "system", targetId: "agent" }],
  configuration: {
    ...emptyAgentConfiguration(),
    sharing: { isGlobal: true, targets: [] },
  },
};

function Rows(): React.ReactElement {
  const profiles = useLoaderData<readonly AgentProfile[]>();
  return (
    <table>
      <tbody>
        {profiles.map((profile) => (
          <AgentProfileRow
            key={profile.id}
            profile={profile}
            connections={[]}
            directory={{ persons: [], groups: [], departments: [] }}
            availability={undefined}
            onEdit={vi.fn()}
          />
        ))}
      </tbody>
    </table>
  );
}

async function selectDelete(): Promise<void> {
  fireEvent.keyDown(
    await screen.findByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: PROFILE.name }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("settings.agents.remove"),
    }),
  );
}

it("submits linked-agent deletion immediately without a dialog or word and revalidates the list", async () => {
  let profiles: readonly AgentProfile[] = [PROFILE];
  const action = vi.fn(async ({ request }: { readonly request: Request }) => {
    expect(Object.fromEntries(await request.formData())).toEqual({
      intent: "delete-profile",
      profileId: "linked",
    });
    profiles = [];
    return { ok: true, intent: "delete-profile" };
  });
  const router = createMemoryRouter(
    [
      {
        path: "/settings/agents",
        loader: () => profiles,
        action,
        element: <Rows />,
      },
    ],
    { initialEntries: ["/settings/agents"] },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  await selectDelete();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  await waitFor(() => expect(screen.queryByText(PROFILE.name)).toBeNull());
  expect(action).toHaveBeenCalledTimes(1);
});

it("disables repeat submission while pending and keeps the row with a translated failure", async () => {
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const action = vi.fn(async () => {
    await pending;
    return Response.json(
      { ok: false, intent: "delete-profile", error: "general" },
      { status: 500 },
    );
  });
  const router = createMemoryRouter(
    [
      {
        path: "/settings/agents",
        loader: () => [PROFILE],
        action,
        element: <Rows />,
      },
    ],
    { initialEntries: ["/settings/agents"] },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  await selectDelete();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", {
          name: i18n.t("settings.agents.actionsFor", { name: PROFILE.name }),
        })
        .hasAttribute("disabled"),
    ).toBe(true),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  finish?.();
  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("assistant.error.general"),
  );
  expect(screen.getByText(PROFILE.name)).toBeDefined();
  expect(action).toHaveBeenCalledTimes(1);
});
