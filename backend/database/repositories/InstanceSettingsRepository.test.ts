import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { InstanceSettingsRepository } from "./InstanceSettingsRepository";

import type { Database } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: InstanceSettingsRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  return {
    execute,
    query,
    repository: new InstanceSettingsRepository({
      execute,
      query,
    } as unknown as Database),
  };
}

it("finds the stored settings", async () => {
  const { repository } = repositoryOf([["Acme", "admin"]]);
  await expect(repository.find()).resolves.toEqual({
    companyName: "Acme",
    primaryAdministratorId: "admin",
  });
});

it("returns null before the first setup", async () => {
  await expect(repositoryOf().repository.find()).resolves.toBeNull();
});

it("saves the settings", async () => {
  const { repository, execute } = repositoryOf();
  await repository.save({ companyName: "A", primaryAdministratorId: "p" });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO instance_settings"),
    { company_name: "A", primary_administrator_id: "p" },
  );
});

it("updates the company name", async () => {
  const { repository, execute } = repositoryOf();
  await repository.updateCompanyName("B");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE instance_settings"),
    { company_name: "B" },
  );
});

it("finds the logo", async () => {
  const image = Buffer.from("png");
  const { repository } = repositoryOf([["image/png", image, "t"]]);
  await expect(repository.findLogo()).resolves.toEqual({
    data: image,
    mimeType: "image/png",
    updatedAt: "t",
  });
});

it("returns null without a logo", async () => {
  const { repository } = repositoryOf();
  await expect(repository.findLogo()).resolves.toBeNull();
  await expect(repository.findLogoVersion()).resolves.toBeNull();
});

it("finds the logo version", async () => {
  const { repository } = repositoryOf([["v1"]]);
  await expect(repository.findLogoVersion()).resolves.toBe("v1");
});

it("saves and deletes the logo", async () => {
  const { repository, execute } = repositoryOf();
  const image = Buffer.from("x");
  await repository.saveLogo({ data: image, mimeType: "image/png" });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO instance_logo"),
    { data: image, mime_type: "image/png" },
  );
  await repository.deleteLogo();
  expect(execute).toHaveBeenLastCalledWith(
    "DELETE FROM instance_logo WHERE id = 1;",
  );
});
