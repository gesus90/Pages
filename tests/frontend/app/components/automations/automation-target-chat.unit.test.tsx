import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ActionFields } from "@/app/components/automations/automation-action-fields";
import { automationDescription } from "@/app/components/automations/automation-description";
import {
  draftFromAutomation,
  emptyDraft,
} from "@/app/components/automations/automation-draft";
import { actionLine } from "@/app/components/automations/automation-labels";
import {
  buildAction,
  buildCreatePayload,
  buildUpdatePayload,
} from "@/app/components/automations/automation-payload";
import { AUTOMATION_TARGET_CHAT_LENGTH } from "@/definition/Automation";
import { createI18n } from "@/app/lib/i18n";

import { automation, now, options } from "./automation-fixture";

import type { AutomationAgentAction } from "@/definition/Automation";

const i18n = createI18n("en");
const t = i18n.t;
const context = {
  t,
  now,
  timeZone: "UTC",
  language: "en",
  names: { agent: "Ada" },
};
const draft = { ...emptyDraft(options, now), instruction: "Do it" };

function agentAction(chat?: string | null): AutomationAgentAction {
  return { type: "agent", agentId: "agent", instruction: "Do it", chat };
}

it("starts an agent action without a target chat", () => {
  expect(emptyDraft(options, now).chat).toBe("");
  expect(draftFromAutomation(automation, options, now).chat).toBe("");
});

it("reads the target chat of a saved agent action into the draft", () => {
  const saved = { ...automation, action: agentAction("[[Pages Team]]") };
  expect(draftFromAutomation(saved, options, now).chat).toBe("[[Pages Team]]");
  const cleared = { ...automation, action: agentAction(null) };
  expect(draftFromAutomation(cleared, options, now).chat).toBe("");
});

it("leaves the target chat out of the action while it is empty", () => {
  expect(buildAction(draft, options)).toEqual({
    value: { type: "agent", agentId: "agent", instruction: "Do it" },
  });
  const built = buildAction({ ...draft, chat: "   " }, options);
  expect(built.value).not.toHaveProperty("chat");
});

it("sends the trimmed target chat of a direct chat and of a group", () => {
  expect(buildAction({ ...draft, chat: "  @Ed " }, options)).toEqual({
    value: { ...agentAction("@Ed") },
  });
  expect(buildAction({ ...draft, chat: "[[Pages Team]]" }, options)).toEqual({
    value: { ...agentAction("[[Pages Team]]") },
  });
});

it("refuses a target chat the server would refuse", () => {
  for (const chat of [
    "Ed",
    "@",
    "[[",
    "[[]]",
    "[[Team]] more",
    "x".repeat(AUTOMATION_TARGET_CHAT_LENGTH + 1),
    `@${"x".repeat(AUTOMATION_TARGET_CHAT_LENGTH)}`,
  ]) {
    expect(buildAction({ ...draft, chat }, options)).toEqual({
      problem: "chat",
    });
  }
  expect(
    buildAction(
      { ...draft, chat: `@${"x".repeat(AUTOMATION_TARGET_CHAT_LENGTH - 1)}` },
      options,
    ).problem,
  ).toBeUndefined();
});

it("ignores the target chat for a plan action", () => {
  expect(
    buildAction({ ...draft, actionType: "plan", chat: "nonsense" }, options),
  ).toEqual({ value: { type: "plan", planId: "plan" } });
});

it("carries the target chat into the create and update payloads", () => {
  const valid = { ...draft, name: "Job", chat: "@Ed" };
  const created = buildCreatePayload(valid, {
    options,
    now,
    operationId: "operation",
  });
  expect(created.value?.action).toEqual(agentAction("@Ed"));
  expect(
    buildCreatePayload(
      { ...valid, chat: "Ed" },
      {
        options,
        now,
        operationId: "operation",
      },
    ),
  ).toEqual({ problem: "chat" });
  const saved = { ...automation, action: agentAction("@Ed") };
  const updated = buildUpdatePayload({ ...valid, chat: "" }, valid, saved, {
    options,
    now,
    operationId: "operation",
  });
  expect(updated.value?.action).toEqual({
    type: "agent",
    agentId: "agent",
    instruction: "Do it",
  });
});

it("shows the target chat in the line of the action", () => {
  expect(actionLine(agentAction(), context)).toBe(
    t("automations.action.agent", { agent: "Ada" }),
  );
  expect(actionLine(agentAction(""), context)).toBe("Agent · Ada");
  expect(actionLine(agentAction("[[Pages Team]]"), context)).toBe(
    "Agent · Ada · Chat: [[Pages Team]]",
  );
});

it("says in the description where the result appears", () => {
  const described = (chat?: string | null): string =>
    automationDescription(
      { ...automation, action: agentAction(chat) },
      context,
    );
  const base = "Runs only when someone starts it, as a job for Ada.";
  expect(described()).toBe(base);
  expect(described("@Ed")).toBe(
    `${base} The result appears in the direct chat with Ed.`,
  );
  expect(described("[[Pages Team]]")).toBe(
    `${base} The result appears in the group “Pages Team”.`,
  );
});

function renderFields(isReadOnly = false): {
  readonly change: ReturnType<typeof vi.fn>;
} {
  const change = vi.fn();
  render(
    <ActionFields
      draft={{ ...draft, chat: "@Ed" }}
      change={change}
      isReadOnly={isReadOnly}
      options={options}
      context={context}
    />,
  );
  return { change };
}

it("offers the target chat as an optional field with its hint", () => {
  const { change } = renderFields();
  const field = screen.getByLabelText("Target chat (optional)");
  expect(field).toBeInstanceOf(HTMLInputElement);
  expect(field.getAttribute("maxlength")).toBe(
    String(AUTOMATION_TARGET_CHAT_LENGTH),
  );
  expect(field.getAttribute("placeholder")).toBe("@Agentname or [[Chatname]]");
  expect(screen.getByDisplayValue("@Ed")).toBe(field);
  expect(
    screen.getByText(
      "@Agentname = personal direct chat, [[Chatname]] = group; empty = the owner's direct chat with the agent",
    ),
  ).toBeTruthy();
  fireEvent.change(field, { target: { value: "[[Team]]" } });
  expect(change).toHaveBeenCalledWith({ chat: "[[Team]]" });
});

it("keeps the target chat read-only for an account that may not change the automation", () => {
  renderFields(true);
  expect(
    screen.getByLabelText("Target chat (optional)").hasAttribute("readonly"),
  ).toBe(true);
});

it("words the field in German", () => {
  render(
    <ActionFields
      draft={draft}
      change={vi.fn()}
      isReadOnly={false}
      options={options}
      context={{ ...context, t: createI18n("de").t }}
    />,
  );
  expect(screen.getByLabelText("Ziel-Chat (optional)")).toBeTruthy();
  expect(
    screen.getByText(
      "@Agentname = persönlicher Direkt-Chat, [[Chatname]] = Gruppe; leer = Direkt-Chat des Eigentümers mit dem Agenten",
    ),
  ).toBeTruthy();
});
