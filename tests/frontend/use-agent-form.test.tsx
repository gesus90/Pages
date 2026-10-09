// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub, useLoaderData, useRevalidator } from "react-router";
import { describe, expect, it } from "vitest";

import { useAgentForm } from "@/app/components/settings/agents/use-agent-form";
import { createI18n } from "@/app/lib/i18n";

import { createAgentConnection } from "../helpers/agents";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";

function FormProbe(): React.ReactElement {
  const connection = useLoaderData<AgentConnectionSummary>();
  const form = useAgentForm("api_key", connection, () => undefined);
  const revalidator = useRevalidator();
  return (
    <>
      <output data-testid="stored">{connection.testModel}</output>
      <output data-testid="form">
        {form.fields.testModel}|{form.fields.reasoningEffort}|
        {String(form.isDirty)}
      </output>
      <button type="button" onClick={() => form.setField("testModel", "mine")}>
        Change
      </button>
      <button type="button" onClick={() => void revalidator.revalidate()}>
        Reload
      </button>
    </>
  );
}

describe("agent form and the stored model", () => {
  it("adopts a model the server stored, but keeps a model changed in the form", async () => {
    let connection = createAgentConnection({ provider: "openrouter" });
    const Stub = createRoutesStub([
      { path: "/", Component: FormProbe, loader: () => connection },
    ]);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <Stub initialEntries={["/"]} />
      </I18nextProvider>,
    );
    const form = await screen.findByTestId("form");
    expect(form).toHaveTextContent(/^\|\|false$/);
    // The default stored after access appears without unsaved changes.
    connection = { ...connection, testModel: "openrouter/free" };
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(form).toHaveTextContent(/^openrouter\/free\|\|false$/),
    );
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(form).toHaveTextContent(/^mine\|\|true$/);
    connection = {
      ...connection,
      testModel: "vendor/other",
      reasoningEffort: "high",
    };
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(screen.getByTestId("stored")).toHaveTextContent("vendor/other"),
    );
    expect(form).toHaveTextContent(/^mine\|\|true$/);
  });
});
