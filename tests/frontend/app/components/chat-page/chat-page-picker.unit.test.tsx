import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPagePicker } from "@/app/components/chat-page/chat-page-picker";
import { useChatPage } from "@/app/components/chat-page/use-chat-page";
import { createI18n } from "@/app/lib/i18n";

import { directory, group, participant } from "./chat-page-fixture";

const fetcher = vi.hoisted(() => ({
  state: "idle",
  data: undefined,
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));
vi.mock("@/app/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: readonly { value: string; label: string; description?: string }[];
    ariaLabel: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label} ({option.description})
        </option>
      ))}
    </select>
  ),
}));

function PickerFixture(): React.ReactElement {
  const page = useChatPage(
    directory({ groups: [group("team")], participants: [participant("ada")] }),
  );
  return <ChatPagePicker page={page} />;
}

it("lists groups and participants and selects each conversation", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <PickerFixture />
    </I18nextProvider>,
  );
  const picker = screen.getByRole("combobox");
  expect(screen.getByRole("option", { name: /Group team/ })).toBeTruthy();
  expect(
    screen.getByRole("option", { name: /Name ada \(Role ada\)/ }),
  ).toBeTruthy();
  expect(picker).toHaveProperty("value", "group:team");
  fireEvent.change(picker, { target: { value: "participant:ada" } });
  expect(picker).toHaveProperty("value", "participant:ada");
  fireEvent.change(picker, { target: { value: "group:team" } });
  expect(picker).toHaveProperty("value", "group:team");
});
