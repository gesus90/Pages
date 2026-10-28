import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanAssetEntry } from "@/app/components/agents/plans/plan-asset-entry";

import { i18n, renderTranslated } from "./plan-flow-fixture";

import type { PlanRemoteFile } from "@/definition/AgentPlanRemoteAccess";

const INPUT: PlanRemoteFile = {
  parameter: "spec",
  name: "notes.txt",
  type: "text/plain",
  size: 12,
  digest: "a".repeat(64),
};

function renderEntry(file: PlanRemoteFile): HTMLElement {
  const { container } = renderTranslated(
    <ul>
      <PlanAssetEntry file={file} />
    </ul>,
  );
  const entry = container.querySelector("li");
  if (!entry) throw new Error("The entry is missing.");
  return entry;
}

it("describes a plain input file as its unchanged original", () => {
  const entry = renderEntry(INPUT);

  expect(entry.textContent).toBe(
    `spec · notes.txt · text/plain · ${i18n.t("plans.remoteAccess.bytes", { count: 12 })}${i18n.t("plans.remoteAccess.original")}`,
  );
  expect(screen.queryByRole("link")).toBeNull();
});

it("marks a staged upload and its model-only representation", () => {
  const entry = renderEntry({
    ...INPUT,
    outcome: "staged",
    representation: "text-extract",
    modelContent: "too large",
    isTruncated: true,
  });

  expect(entry.textContent).toContain(i18n.t("plans.remoteAccess.staged"));
  expect(entry.textContent).not.toContain(
    i18n.t("plans.remoteAccess.uploaded"),
  );
  expect(entry.textContent).toContain(
    i18n.t("plans.remoteAccess.text-extract"),
  );
  expect(entry.textContent).toContain(
    i18n.t("plans.remoteAccess.file-only", { reason: "too large" }),
  );
  expect(entry.textContent).toContain(i18n.t("plans.remoteAccess.truncated"));
});

it("offers the permanently uploaded original for download", () => {
  const entry = renderEntry({
    ...INPUT,
    outcome: "uploaded",
    representation: "source",
    asset: { source: "ticket", id: "asset-1", link: "/attachments/asset-1" },
  });
  const download = screen.getByRole("link", {
    name: i18n.t("plans.remoteAccess.original"),
  });

  expect(entry.textContent).toContain(i18n.t("plans.remoteAccess.uploaded"));
  expect(entry.textContent).not.toContain(i18n.t("plans.remoteAccess.staged"));
  expect(download.getAttribute("href")).toBe("/attachments/asset-1");
  expect(download.hasAttribute("download")).toBe(true);
});
