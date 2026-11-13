import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AgentSessionLimitsCard } from "@/app/components/settings/agents/agent-session-limits-card";
import { createI18n } from "@/app/lib/i18n";

import type { AgentSessionLimitsAdministration } from "@/definition/AgentSessionLimits";

const fetcher = vi.hoisted(() => ({
  state: "idle" as const,
  data: undefined,
  Form: (props: React.ComponentProps<"form">): React.ReactElement => (
    <form {...props} />
  ),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));

const i18n = createI18n("de");

const ADMINISTRATION: AgentSessionLimitsAdministration = {
  limits: {
    perAgent: 4,
    total: 16,
    revision: 3,
    dreamTime: "03:00",
    idleMinutes: 25,
  },
  running: 1,
  waiting: 0,
};

it("submits the idle time of a resting chat session with the limits (PAGE-335)", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <AgentSessionLimitsCard administration={ADMINISTRATION} />
    </I18nextProvider>,
  );
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  expect(Object.fromEntries(new FormData(form))).toEqual({
    intent: "save-agent-session-limits",
    revision: "3",
    perAgent: "4",
    total: "16",
    dreamTime: "03:00",
    idleMinutes: "25",
  });
  const idle = screen.getByRole("spinbutton", {
    name: i18n.t("agentSessionLimits.idleMinutes"),
  });
  expect(idle.getAttribute("min")).toBe("1");
  expect(idle.getAttribute("max")).toBe("1440");
  expect(
    screen.getByText(
      i18n.t("agentSessionLimits.idleMinutesHint", { maximum: 1440 }),
    ),
  ).toBeTruthy();
});

const WITH_MODELS: AgentSessionLimitsAdministration = {
  ...ADMINISTRATION,
  logbookModel: { connectionId: "cheap-connection", model: "cheap-model" },
  logbookModels: [
    {
      connectionId: "cheap-connection",
      model: "cheap-model",
      label: "Cheap Model",
    },
    {
      connectionId: "other-connection",
      model: "other-model",
      label: "Other Model",
    },
  ],
};

function logbookForm(): HTMLFormElement {
  const form = document.querySelectorAll("form")[1];
  if (!form) throw new Error("Missing form of the logbook model");
  return form;
}

it("offers the model of the Lagebuch summary of the instance in a form of its own (PAGE-377)", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <AgentSessionLimitsCard administration={WITH_MODELS} />
    </I18nextProvider>,
  );
  expect(Object.fromEntries(new FormData(logbookForm()))).toEqual({
    intent: "save-agent-logbook-model",
    connectionId: "cheap-connection",
    model: "cheap-model",
  });
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("agentSessionLimits.logbookModel"),
    }).textContent,
  ).toContain("Cheap Model");
  expect(
    screen.getByText(i18n.t("agentSessionLimits.logbookModelHint")),
  ).toBeTruthy();
});

it("submits another model of the choice, and no model for the model of each agent", async () => {
  render(
    <I18nextProvider i18n={i18n}>
      <AgentSessionLimitsCard administration={WITH_MODELS} />
    </I18nextProvider>,
  );
  const combobox = screen.getByRole("combobox", {
    name: i18n.t("agentSessionLimits.logbookModel"),
  });
  fireEvent.keyDown(combobox, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Other Model" }));
  expect(Object.fromEntries(new FormData(logbookForm()))).toMatchObject({
    connectionId: "other-connection",
    model: "other-model",
  });
  fireEvent.keyDown(combobox, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("option", {
      name: i18n.t("agentSessionLimits.logbookModelAgent"),
    }),
  );
  expect(Object.fromEntries(new FormData(logbookForm()))).toMatchObject({
    connectionId: "",
    model: "",
  });
});

it("keeps working with an older kept answer that knows no Lagebuch model", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <AgentSessionLimitsCard administration={ADMINISTRATION} />
    </I18nextProvider>,
  );
  expect(Object.fromEntries(new FormData(logbookForm()))).toMatchObject({
    connectionId: "",
    model: "",
  });
});
