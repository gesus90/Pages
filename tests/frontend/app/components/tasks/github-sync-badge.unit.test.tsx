import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { createI18n } from "@/app/lib/i18n";

const linked = {
  githubIssueNumber: 42,
  githubConflict: false,
  githubLastError: null,
  githubLastSyncAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

it("shows the current synchronization state and error detail", () => {
  const view = render(
    <I18nextProvider i18n={createI18n("en")}>
      <GitHubSyncBadge {...linked} />
    </I18nextProvider>,
  );
  expect(screen.getByTitle("Synchronized").textContent).toBe("Synchronized");
  view.rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <GitHubSyncBadge {...linked} githubIssueNumber={null} />
    </I18nextProvider>,
  );
  expect(screen.getByTitle("Not linked").textContent).toBe("Not linked");
  view.rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <GitHubSyncBadge {...linked} githubLastSyncAt={null} />
    </I18nextProvider>,
  );
  expect(screen.getByTitle("Local changes").textContent).toBe("Local changes");
  view.rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <GitHubSyncBadge {...linked} githubLastError="Rate limit" />
    </I18nextProvider>,
  );
  expect(screen.getByTitle("Sync failed: Rate limit").textContent).toBe(
    "Sync failed",
  );
  view.rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <GitHubSyncBadge {...linked} githubConflict isSyncing />
    </I18nextProvider>,
  );
  const badge = screen.getByTitle("Sync failed");
  expect(badge.querySelector("svg.animate-spin")).not.toBeNull();
  expect(badge.textContent).toBe("Sync failed");
});
