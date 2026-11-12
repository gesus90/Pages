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
        limits={{ repliesPerAgentPerOrigin: 4, automaticRepliesPerOrigin: 8 }}
        isDisabled={isDisabled}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  return onChange;
}

it("offers bounded group limits and changes one while retaining the other", () => {
  const onChange = renderLimits();
  const perAgent = screen.getByRole("combobox", {
    name: "Replies per agent (including follow-ups)",
  });
  const perRound = screen.getByRole("combobox", {
    name: "Total agent contributions",
  });
  expect(perAgent.querySelectorAll("option")).toHaveLength(4);
  expect(perRound.querySelectorAll("option")).toHaveLength(9);
  fireEvent.change(perRound, { target: { value: "9" } });
  expect(onChange).toHaveBeenLastCalledWith({
    repliesPerAgentPerOrigin: 4,
    automaticRepliesPerOrigin: 9,
  });
  fireEvent.change(perAgent, { target: { value: "2" } });
  expect(onChange).toHaveBeenLastCalledWith({
    repliesPerAgentPerOrigin: 2,
    automaticRepliesPerOrigin: 8,
  });
});

it("disables changes when the settings are read-only or saving", () => {
  renderLimits(true);
  for (const select of screen.getAllByRole("combobox"))
    expect(select.hasAttribute("disabled")).toBe(true);
});
