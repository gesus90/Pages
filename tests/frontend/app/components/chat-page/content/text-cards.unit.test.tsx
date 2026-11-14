import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import {
  CodeCard,
  DiffCard,
  MarkdownCard,
} from "@/app/components/chat-page/content/text-cards";
import { createI18n } from "@/app/lib/i18n";

const actions = vi.hoisted(() => ({ copy: vi.fn(), save: vi.fn() }));
vi.mock("@/app/components/chat-page/content/use-card-text", () => ({
  useCardText: (text: { source: string | null }) => ({
    source: text.source,
    isFailed: false,
  }),
  copyText: actions.copy,
  saveTextFile: actions.save,
}));

const origin = { senderName: "Ada" };

it("renders a short code card and copies or saves its source", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <CodeCard
        cardKey="code"
        name="hello.ts"
        languageHint="ts"
        text={{ source: "const x = 1;" }}
        origin={origin}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("region", { name: "hello.ts" }).textContent,
  ).toContain("const x = 1;");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  fireEvent.click(screen.getByRole("button", { name: "As file" }));
  expect(actions.copy).toHaveBeenCalledWith("const x = 1;");
  expect(actions.save).toHaveBeenCalledWith("hello.ts", "const x = 1;");
});

it("collapses long code and diff cards while keeping Markdown expanded", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <CodeCard
        cardKey="long"
        name="long.ts"
        languageHint="ts"
        text={{ source: Array(16).fill("line").join("\n") }}
        origin={origin}
      />
      <DiffCard
        cardKey="diff"
        name="changes"
        text={{ source: "+new" }}
        origin={origin}
      />
      <MarkdownCard
        cardKey="markdown"
        name="notes"
        text={{ source: "**important**" }}
        origin={origin}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("region", { name: "long.ts" }).textContent,
  ).not.toContain("line\nline");
  expect(
    screen.getByRole("region", { name: "changes" }).textContent,
  ).not.toContain("+new");
  expect(screen.getByRole("region", { name: "notes" }).textContent).toContain(
    "important",
  );
});
