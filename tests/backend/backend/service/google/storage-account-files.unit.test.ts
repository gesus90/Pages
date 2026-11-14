import { describe, expect, it } from "vitest";

import { storageWorld } from "./page323-storage-fixture";

describe("account-bound storage files", () => {
  it("limits capabilities and operations to granted folders", async () => {
    const world = storageWorld();
    const account = world.files.forAccount("Ed");
    expect(await account.capabilities("pages")).toMatchObject({
      ok: true,
      value: {
        canRequestWriteAccess: false,
        grantedFolders: [{ ref: "pages", name: "Pages" }],
      },
    });
    expect(await account.capabilities("private")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await account.reader.stat("report")).toMatchObject({
      ok: true,
      value: { entry: { ref: "report" } },
    });
    expect(await account.reader.stat("private")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.repository.record).toHaveBeenCalled();
  });

  it("does not reveal path lookup errors to a non-administrator", async () => {
    const world = storageWorld();
    const account = world.files.forAccount("Ed");
    expect(await account.reader.resolvePath("/does-not-exist")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
