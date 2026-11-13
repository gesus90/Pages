import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { filterLogbookEntries } from "@/app/components/agent-settings/agent-logbook-display";
import { createI18n } from "@/app/lib/i18n";

import {
  allFields,
  logbookEntry,
  logbookOverview,
  stubLogbookEndpoint,
} from "./agent-logbook-fixture";

import type { ComponentProps } from "react";
import type { AgentLogbookOverview } from "@/definition/AgentLogbook";

const i18n = createI18n("en");

const DECISION = logbookEntry("e1");
const OPEN = logbookEntry("e2", {
  kind: "open",
  text: "Mei writes the release notes until Wednesday.",
  topic: "Release notes",
  at: "2026-11-13T17:20:00.000Z",
  source: { kind: "group", id: "g2", name: "Release" },
  participants: ["Mei"],
  origin: "background",
});
const FACT = logbookEntry("e3", {
  kind: "fact",
  text: "Igor likes short answers.",
  topic: "Short answers",
  at: "2026-11-12T09:00:00.000Z",
  source: { kind: "direct", id: "person-1", name: "Igor" },
  participants: ["Igor"],
});
const CHEAP = {
  connectionId: "cheap-connection",
  model: "cheap-model",
  label: "Cheap Model",
};
const FULL = logbookOverview({
  entries: [OPEN, FACT, DECISION],
  count: 170,
  fillPercent: 85,
  chats: [OPEN.source, FACT.source, DECISION.source],
  models: [CHEAP],
});

function answer(overview: AgentLogbookOverview = FULL) {
  return { ok: true as const, overview };
}

function renderDialog(
  props: Partial<ComponentProps<typeof AgentSettingsDialog>> = {},
  language = i18n,
): void {
  render(
    <I18nextProvider i18n={language}>
      <AgentSettingsDialog
        agentId="ed"
        initialTab="logbook"
        onClose={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

async function entryRows(): Promise<HTMLElement[]> {
  const table = await screen.findByRole("table", { name: "Logbook of Ed" });
  return within(table).getAllByRole("row").slice(1);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens in the tab Logbook and reads the entries of the agent from the endpoint with the cookies of the page", async () => {
  const { calls } = stubLogbookEndpoint(() => answer());
  renderDialog({ agentId: "ed/1" });
  await entryRows();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("/chat-page-api/agent-logbook?agentId=ed%2F1");
  expect(calls[0]?.method).toBe("GET");
  expect(calls[0]?.headers.get("Accept")).toBe("application/json");
  expect(calls[0]?.headers.get("X-Pages-Data-Request")).toBe("1");
  expect(
    screen.getByRole("tab", { name: "Logbook" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("reads the Lagebuch only when its tab opens", async () => {
  const { calls } = stubLogbookEndpoint(() => answer());
  renderDialog({ initialTab: "sessions" });
  // The sessions tab is shown; nothing of the Lagebuch was asked for yet.
  await screen.findByText("This agent has no sessions yet.");
  expect(calls).toHaveLength(0);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Logbook" }));
  fireEvent.click(screen.getByRole("tab", { name: "Logbook" }));
  await entryRows();
  expect(calls).toHaveLength(1);
});

it("shows fill level, limit, quiet time and the model for the background summary", async () => {
  stubLogbookEndpoint(() => answer());
  renderDialog();
  await entryRows();
  expect(screen.getByText("Fill level")).toBeTruthy();
  expect(screen.getByText("170 of 200 entries")).toBeTruthy();
  expect(
    screen.getByRole("meter", { name: "Fill level of the logbook" }).getAttribute("aria-valuenow"),
  ).toBe("85");
  expect(screen.getByText(/At about 80 %/)).toBeTruthy();
  expect((screen.getByLabelText("Limit") as HTMLInputElement).value).toBe("200");
  expect((screen.getByLabelText("Quiet time") as HTMLInputElement).value).toBe("2");
  expect(screen.getByText("Background summary")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Model for it" }).textContent).toContain(
    "The agent's model",
  );
});

it("lists every entry with time, chat, kind, text, people and origin, the newest first", async () => {
  stubLogbookEndpoint(() => answer());
  renderDialog();
  const [openRow, factRow, decisionRow] = await entryRows();
  expect(within(openRow).getByText("Group “Release”")).toBeTruthy();
  expect(within(openRow).getByText("Task/Open")).toBeTruthy();
  expect(within(openRow).getByText("Mei writes the release notes until Wednesday.")).toBeTruthy();
  expect(within(openRow).getByText("People involved: Mei")).toBeTruthy();
  expect(within(openRow).getByText("Background")).toBeTruthy();
  expect(within(factRow).getByText("Direct · Igor")).toBeTruthy();
  expect(within(factRow).getByText("Fact")).toBeTruthy();
  expect(within(decisionRow).getByText("Group “Pages-Team”")).toBeTruthy();
  expect(within(decisionRow).getByText("Decision")).toBeTruthy();
  expect(within(decisionRow).getByText("PAGE-370 übernimmt Ed bis Freitag.")).toBeTruthy();
  expect(within(decisionRow).getByText("People involved: Igor, Mei")).toBeTruthy();
  expect(within(decisionRow).getByText("Agent")).toBeTruthy();
  // The time of the entry in the format of the visitor.
  expect(within(decisionRow).getByText(/13\.11\.2026|11\/13\/2026|2026-11-13/u)).toBeTruthy();
});

it("narrows the entries with the search and says how many are shown", async () => {
  stubLogbookEndpoint(() => answer());
  renderDialog();
  await entryRows();
  expect(screen.getByText("3 of 3 entries shown")).toBeTruthy();
  const search = screen.getByRole("searchbox", { name: "Search entries" });

  fireEvent.change(search, { target: { value: "release wednesday" } });
  expect(await entryRows()).toHaveLength(1);
  expect(screen.getByText("1 of 3 entries shown")).toBeTruthy();

  // The chat name and the people are searched, too.
  fireEvent.change(search, { target: { value: "igor" } });
  expect(await entryRows()).toHaveLength(2);

  fireEvent.change(search, { target: { value: "nothing like this" } });
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText("No entries match the search and filters.")).toBeTruthy();
});

it("filters the entries by kind and by chat", async () => {
  stubLogbookEndpoint(() => answer());
  renderDialog();
  await entryRows();

  fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by kind" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Fact" }));
  const factRows = await entryRows();
  expect(factRows).toHaveLength(1);
  expect(within(factRows[0] as HTMLElement).getByText("Direct · Igor")).toBeTruthy();

  fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by kind" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: "All kinds" }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by chat" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Group “Release”" }));
  const releaseRows = await entryRows();
  expect(releaseRows).toHaveLength(1);
  expect(within(releaseRows[0] as HTMLElement).getByText("Task/Open")).toBeTruthy();
});

it("filters by search words, kind and chat together", () => {
  const entries = [OPEN, FACT, DECISION];
  const all = { query: "", kind: "all", chat: "all" } as const;
  expect(filterLogbookEntries(entries, all)).toHaveLength(3);
  expect(filterLogbookEntries(entries, { ...all, kind: "open" })).toEqual([OPEN]);
  expect(filterLogbookEntries(entries, { ...all, chat: "group:g1" })).toEqual([DECISION]);
  expect(filterLogbookEntries(entries, { ...all, chat: "direct:g1" })).toEqual([]);
  expect(filterLogbookEntries(entries, { ...all, query: "  PAGE-370  " })).toEqual([DECISION]);
  expect(
    filterLogbookEntries(entries, { query: "igor", kind: "fact", chat: "direct:person-1" }),
  ).toEqual([FACT]);
  expect(
    filterLogbookEntries(entries, { query: "igor", kind: "open", chat: "all" }),
  ).toEqual([]);
});

it("removes an entry and shows the Lagebuch the server answers with", async () => {
  const { calls, bodies } = stubLogbookEndpoint((call) =>
    call.method === "POST"
      ? answer(logbookOverview({ entries: [OPEN, FACT], count: 169, fillPercent: 85, chats: FULL.chats }))
      : answer(),
  );
  renderDialog();
  await entryRows();
  fireEvent.click(screen.getByRole("button", { name: "Delete entry: PAGE-370" }));
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]?.method).toBe("POST");
  expect(calls[1]?.fields.intent).toBe("remove-entries");
  expect(calls[1]?.fields.agentId).toBe("ed");
  expect(allFields(bodies[1], "entryId")).toEqual(["e1"]);
  await vi.waitFor(async () => expect(await entryRows()).toHaveLength(2));
  expect(screen.getByText("169 of 200 entries")).toBeTruthy();
});

it("saves limit, quiet time and model and shows that it worked", async () => {
  const { calls } = stubLogbookEndpoint((call) =>
    call.method === "POST"
      ? answer(
          logbookOverview({
            ...FULL,
            settings: { limit: 120, quietMinutes: 5, model: CHEAP },
          }),
        )
      : answer(),
  );
  renderDialog();
  await entryRows();
  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "120" } });
  fireEvent.change(screen.getByLabelText("Quiet time"), { target: { value: "5" } });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Model for it" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Cheap Model" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]?.fields).toEqual({
    intent: "save-settings",
    agentId: "ed",
    limit: "120",
    quietMinutes: "5",
    modelConnectionId: "cheap-connection",
    model: "cheap-model",
  });
  expect(await screen.findByText("Settings saved.")).toBeTruthy();
  // The entries restart from what the server saved.
  expect((screen.getByLabelText("Limit") as HTMLInputElement).value).toBe("120");
  expect((screen.getByLabelText("Quiet time") as HTMLInputElement).value).toBe("5");
  expect(screen.getByRole("combobox", { name: "Model for it" }).textContent).toContain(
    "Cheap Model",
  );
});

it("names the model of the instance as the default of the model choice", async () => {
  stubLogbookEndpoint(() =>
    answer(logbookOverview({ ...FULL, instanceModel: CHEAP })),
  );
  renderDialog();
  await entryRows();
  expect(screen.getByRole("combobox", { name: "Model for it" }).textContent).toContain(
    "Instance default: Cheap Model",
  );
});

it("checks limit and quiet time against their ranges before it sends anything", async () => {
  const { calls } = stubLogbookEndpoint(() => answer());
  renderDialog();
  await entryRows();
  const save = screen.getByRole("button", { name: "Save" });
  expect(save.hasAttribute("disabled")).toBe(false);

  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "9" } });
  expect(screen.getByText("Enter whole numbers from 10 to 2000.")).toBeTruthy();
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "2000" } });
  expect(save.hasAttribute("disabled")).toBe(false);

  fireEvent.change(screen.getByLabelText("Quiet time"), { target: { value: "0" } });
  expect(screen.getByText("Enter whole minutes from 1 to 240.")).toBeTruthy();
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Quiet time"), { target: { value: "2.5" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  expect(calls).toHaveLength(1);
});

it("shows the settings to a viewer who may not change them, without a way to save", async () => {
  stubLogbookEndpoint(() =>
    answer(logbookOverview({ ...FULL, canChangeSettings: false, models: [], settings: { limit: 200, quietMinutes: 2, model: CHEAP } })),
  );
  renderDialog();
  await entryRows();
  expect((screen.getByLabelText("Limit") as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText("Quiet time") as HTMLInputElement).readOnly).toBe(true);
  expect(screen.queryByRole("combobox", { name: "Model for it" })).toBeNull();
  expect(screen.getByText("You can view these settings but not change them.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
});

it("says why a change was refused and keeps the entries", async () => {
  stubLogbookEndpoint((call) =>
    call.method === "POST" ? { ok: false, error: "forbidden" } : answer(),
  );
  renderDialog();
  await entryRows();
  fireEvent.click(screen.getByRole("button", { name: "Delete entry: PAGE-370" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "You are not allowed to do that.",
  );
  expect(await entryRows()).toHaveLength(3);
});

it("says that there are no entries yet", async () => {
  stubLogbookEndpoint(() => answer(logbookOverview()));
  renderDialog();
  expect(
    await screen.findByText(
      "No entries yet. The agent keeps here what it needs to know across chats.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

it("shows a hint while the Lagebuch loads and why it could not be read, with a way to try again", async () => {
  let isFailing = true;
  stubLogbookEndpoint(() =>
    isFailing ? { ok: false, error: "unavailable" } : answer(),
  );
  renderDialog();
  expect(screen.getByText("Loading the logbook …")).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The logbook is not reachable right now. Try again in a moment.",
  );
  isFailing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await entryRows()).toHaveLength(3);
});

it("words the tab in German", async () => {
  stubLogbookEndpoint(() => answer());
  renderDialog({}, createI18n("de"));
  const table = await screen.findByRole("table", { name: "Lagebuch von Ed" });
  expect(screen.getByText("Füllstand")).toBeTruthy();
  expect(screen.getByText("170 von 200 Einträgen")).toBeTruthy();
  expect(screen.getByLabelText("Obergrenze")).toBeTruthy();
  expect(screen.getByLabelText("Ruhezeit")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Modell dafür" })).toBeTruthy();
  expect(screen.getByRole("searchbox", { name: "Einträge durchsuchen" })).toBeTruthy();
  expect(within(table).getByText("Gruppe „Pages-Team“")).toBeTruthy();
  expect(within(table).getByText("Entscheidung")).toBeTruthy();
  expect(within(table).getByText("Aufgabe/Offen")).toBeTruthy();
  expect(within(table).getByText("Hintergrund")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Eintrag löschen: PAGE-370" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
});
