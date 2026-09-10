// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";

import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

function renderBadge(
  overrides: Partial<Parameters<typeof GitHubSyncBadge>[0]> = {},
): void {
  const i18n = createI18n(LANGUAGE.GERMAN);

  render(
    <I18nextProvider i18n={i18n}>
      <GitHubSyncBadge
        githubConflict={false}
        githubIssueNumber={null}
        githubLastError={null}
        githubLastSyncAt={null}
        updatedAt="2026-09-05T14:00:00.000Z"
        {...overrides}
      />
    </I18nextProvider>,
  );
}

describe("GitHubSyncBadge", () => {
  it("reports unlinked tickets in gray", () => {
    renderBadge();

    expect(screen.getByText("Nicht verknüpft")).toBeInTheDocument();
  });

  it("reports synchronized tickets in green", () => {
    renderBadge({
      githubIssueNumber: 42,
      githubLastSyncAt: "2026-09-05T15:00:00.000Z",
    });

    expect(screen.getByText("Synchronisiert")).toBeInTheDocument();
  });

  it("reports pending tickets with local changes", () => {
    renderBadge({
      githubIssueNumber: 42,
      githubLastSyncAt: null,
      updatedAt: "2026-09-05T16:00:00.000Z",
    });

    expect(screen.getByText("Lokale Änderungen")).toBeInTheDocument();
  });

  it("reports conflicts as failed without a message", () => {
    renderBadge({ githubConflict: true, githubIssueNumber: 42 });

    expect(screen.getByText("Sync fehlgeschlagen")).toBeInTheDocument();
  });

  it("shows the stored error message as a tooltip", () => {
    renderBadge({
      githubIssueNumber: 42,
      githubLastError: "GitHub rejected the request with status 403.",
      githubLastSyncAt: "2026-09-05T15:00:00.000Z",
      updatedAt: "2026-09-05T14:00:00.000Z",
    });

    expect(screen.getByText("Sync fehlgeschlagen")).toBeInTheDocument();
    expect(
      screen.getByTitle(/GitHub rejected the request with status 403\./),
    ).toBeInTheDocument();
  });

  it("shows a spinner while synchronizing", () => {
    renderBadge({
      githubIssueNumber: 42,
      githubLastSyncAt: "2026-09-05T15:00:00.000Z",
      isSyncing: true,
    });

    expect(screen.getByText("Synchronisiert")).toBeInTheDocument();
  });
});
