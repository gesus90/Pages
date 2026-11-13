import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPageRoundLimits } from "@/app/components/chat-page/chat-page-round-limits";
import { createI18n } from "@/app/lib/i18n";

import type { ComponentProps } from "react";

vi.mock("@/app/components/ui/select", () => ({
  Select: ({
    id,
    ariaLabel,
    value,
    disabled,
    options,
    onValueChange,
  }: {
    readonly id: string;
    readonly ariaLabel: string;
    readonly value: string;
    readonly disabled: boolean;
    readonly options: readonly {
      readonly value: string;
      readonly label: string;
    }[];
    readonly onValueChange: (value: string) => void;
  }): React.ReactElement => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

function renderLimits(
  isDisabled = false,
): ComponentProps<typeof ChatPageRoundLimits>["onChange"] {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ChatPageRoundLimits
        limits={{ automaticRepliesPerOrigin: 8 }}
        isDisabled={isDisabled}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  return onChange;
}

it("offers only the bounded limit without @; no limit per agent remains (PAGE-349)", () => {
  const onChange = renderLimits();
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  const perRound = screen.getByRole("combobox", {
    name: "Contributions without @ (observer, decision model)",
  });
  expect(perRound.querySelectorAll("option")).toHaveLength(9);
  fireEvent.change(perRound, { target: { value: "9" } });
  expect(onChange).toHaveBeenLastCalledWith({ automaticRepliesPerOrigin: 9 });
  expect(screen.queryByText(/Replies per agent/u)).toBeNull();
  expect(screen.getByText(/without a limit per round/u)).toBeTruthy();
});

it("disables changes when the settings are read-only or saving", () => {
  renderLimits(true);
  for (const select of screen.getAllByRole("combobox"))
    expect(select.hasAttribute("disabled")).toBe(true);
});
