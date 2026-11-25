import { expect, it, vi } from "vitest";

import {
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { WikiVersionService } from "./WikiVersionService";

import { ROLE } from "@/definition/Role";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess } from "./WikiAccess";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

function serviceOf(
  page: object | null,
  version: object | null = null,
): {
  readonly service: WikiVersionService;
  readonly versions: Record<string, ReturnType<typeof vi.fn>>;
} {
  const versions = {
    find: vi.fn(async () => version),
    list: vi.fn(async () => [{ id: "v" }]),
    prune: vi.fn(async () => {}),
  };
  const repository = {
    pages: { findVisible: vi.fn(async () => page) },
    versions,
  } as unknown as WikiRepository;
  const access = {
    resolve: vi.fn(async () => ({ scope: { userId: "u" } })),
  } as unknown as WikiAccess;

  return { service: new WikiVersionService(repository, access), versions };
}

it("lists the versions of a visible page", async () => {
  const { service } = serviceOf({ id: "p" });

  await expect(service.list(actor, "p")).resolves.toEqual([{ id: "v" }]);
});

it("hides the versions of an invisible page", async () => {
  const { service } = serviceOf(null);

  await expect(service.list(actor, "p")).rejects.toThrow(WikiPageNotFoundError);
});

it("reads one version", async () => {
  const { service } = serviceOf({ id: "p" }, { id: "v" });

  await expect(service.get(actor, "p", "v")).resolves.toEqual({ id: "v" });
});

it("rejects a missing version", async () => {
  const { service } = serviceOf({ id: "p" });

  await expect(service.get(actor, "p", "v")).rejects.toThrow(
    WikiValidationError,
  );
});

it("prunes versions by the retention rules", async () => {
  const { service, versions } = serviceOf(null);

  await service.prune(30, 5);

  expect(versions.prune).toHaveBeenCalledWith(30, 5);
});
