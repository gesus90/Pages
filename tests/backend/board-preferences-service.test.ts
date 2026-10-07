import { describe, expect, it } from "vitest";

import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import { BoardPreferencesService } from "@/backend/service/BoardPreferencesService";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

import { useMigratedDatabase } from "../helpers/test-database";

describe("board preferences persistence", () => {
  const getDatabase = useMigratedDatabase();

  function createService(): BoardPreferencesService {
    return new BoardPreferencesService(
      new UserBoardPreferencesRepository(getDatabase()),
    );
  }

  it("returns the defaults before anything is saved", async () => {
    await expect(createService().find("user-1")).resolves.toEqual(
      DEFAULT_BOARD_PREFERENCES,
    );
  });

  it("saves and reads the preferences of each user separately", async () => {
    const service = createService();

    await service.save("user-1", { group: "project", view: "list" });
    await service.save("user-2", { scope: "mine" });

    await expect(service.find("user-1")).resolves.toEqual({
      ...DEFAULT_BOARD_PREFERENCES,
      group: "project",
      view: "list",
    });
    await expect(service.find("user-2")).resolves.toEqual({
      ...DEFAULT_BOARD_PREFERENCES,
      scope: "mine",
    });
  });

  it("replaces earlier preferences and stores only normalized values", async () => {
    const service = createService();

    await service.save("user-1", { view: "list" });

    await expect(
      service.save("user-1", { group: "<script>", scope: "mine" }),
    ).resolves.toEqual({ ...DEFAULT_BOARD_PREFERENCES, scope: "mine" });
    await expect(
      getDatabase().query(
        "SELECT preferences FROM user_board_preferences WHERE user_id = 'user-1';",
      ),
    ).resolves.toEqual([
      [JSON.stringify({ ...DEFAULT_BOARD_PREFERENCES, scope: "mine" })],
    ]);
  });

  it("falls back to the defaults when the stored text is damaged", async () => {
    await getDatabase().execute(
      "INSERT INTO user_board_preferences (user_id, preferences) VALUES ('user-1', '{broken');",
    );

    await expect(createService().find("user-1")).resolves.toEqual(
      DEFAULT_BOARD_PREFERENCES,
    );
  });
});
