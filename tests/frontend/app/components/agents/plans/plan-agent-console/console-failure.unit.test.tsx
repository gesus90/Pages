import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ConsoleFailure } from "@/app/components/agents/plans/plan-agent-console/console-failure";

import { renderConsole } from "./console-fixture";

it("stays silent without a remote record or a storage failure", () => {
  const { rerender } = renderConsole(<ConsoleFailure />);
  expect(screen.queryByRole("alert")).toBeNull();
  rerender(<ConsoleFailure remote={{ reason: "lost", storageError: "" }} />);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("names the generic journal write failure for a storage reason without a code", () => {
  renderConsole(<ConsoleFailure remote={{ reason: "storage" }} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "History storage failed (journal_write_failed). Confirmed output has been preserved.",
  );
});

it("names a reported storage code even without the storage reason", () => {
  renderConsole(
    <ConsoleFailure remote={{ reason: null, storageError: "EACCES" }} />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "History storage failed (EACCES). Confirmed output has been preserved.",
  );
});
