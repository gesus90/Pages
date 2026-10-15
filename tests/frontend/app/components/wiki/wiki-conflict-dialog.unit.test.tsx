import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { WikiConflictDialog } from "@/app/components/wiki/wiki-conflict-dialog";
import { createI18n } from "@/app/lib/i18n";

it("compares conflicting text and lets the person hide the comparison", () => {
  const i18n = createI18n("en");
  render(
    <I18nextProvider i18n={i18n}>
      <WikiConflictDialog
        mine={"shared\nmy edit"}
        theirs={"shared\ntheir edit"}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("dialog", { name: i18n.t("wiki.conflict.title") }),
  ).toBeTruthy();
  const compare = screen.getByRole("button", {
    name: i18n.t("wiki.conflict.compare"),
  });
  expect(
    screen.queryByLabelText(i18n.t("wiki.conflict.differences")),
  ).toBeNull();
  fireEvent.click(compare);
  const differences = screen.getByLabelText(
    i18n.t("wiki.conflict.differences"),
  );
  expect(differences.textContent).toContain("- their edit");
  expect(differences.textContent).toContain("+ my edit");
  fireEvent.click(compare);
  expect(
    screen.queryByLabelText(i18n.t("wiki.conflict.differences")),
  ).toBeNull();
});

it.each(["keepMine", "takeTheirs"] as const)(
  "invokes only the selected resolution: %s",
  (choice) => {
    const i18n = createI18n("en");
    const keepMine = vi.fn();
    const takeTheirs = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <WikiConflictDialog
          mine="mine"
          theirs="theirs"
          onKeepMine={keepMine}
          onTakeTheirs={takeTheirs}
        />
      </I18nextProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t(`wiki.conflict.${choice}`) }),
    );
    expect(keepMine).toHaveBeenCalledTimes(choice === "keepMine" ? 1 : 0);
    expect(takeTheirs).toHaveBeenCalledTimes(choice === "takeTheirs" ? 1 : 0);
  },
);
