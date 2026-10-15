import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { ChatContextIndicator } from "@/app/components/chat/chat-context-indicator";
import { createI18n } from "@/app/lib/i18n";

import type { ChatContextSize } from "@/definition/Chat";

function indicator(context: ChatContextSize | null): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("de")}>
      <ChatContextIndicator context={context} />
    </I18nextProvider>
  );
}

it("makes context units, estimate, limit and utilization available on keyboard focus and dismisses with Escape", () => {
  render(indicator({ tokens: 2000, limit: 8000, isEstimated: true }));
  const button = screen.getByRole("button", {
    name: "Gesprächskontext: Schätzung: 2000 Tokens",
  });
  expect(screen.queryByRole("tooltip")).toBeNull();
  act(() => {
    button.focus();
  });
  const tooltip = screen.getByRole("tooltip");
  expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  expect(tooltip.textContent).toContain("Schätzung: 2000 Tokens");
  expect(tooltip.textContent).toContain("Modelllimit: 8000 Tokens");
  expect(tooltip.textContent).toContain("25 %");
  expect(tooltip.textContent).toContain("Ohne Systemanweisungen");
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.blur(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("shows unavailable values and unknown limits clearly and supports pointer and touch", () => {
  const rendered = render(indicator(null));
  const button = screen.getByRole("button");
  fireEvent.mouseEnter(button);
  expect(screen.getByRole("tooltip").textContent).toContain(
    "Kontextgröße derzeit nicht verfügbar",
  );
  expect(screen.getByRole("tooltip").textContent).toContain(
    "Modelllimit unbekannt",
  );
  fireEvent.mouseLeave(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  rendered.rerender(
    indicator({ tokens: 500, limit: null, isEstimated: false }),
  );
  fireEvent.click(button);
  expect(screen.getByRole("tooltip").textContent).toContain("500 Tokens");
  expect(screen.getByRole("tooltip").textContent).not.toContain(
    "Schätzung: 500 Tokens",
  );
});
