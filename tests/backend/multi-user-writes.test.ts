import { describe, expect, it } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserService } from "@/backend/service/UserService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { useMigratedDatabase } from "../helpers/test-database";

const WRITERS = 12;

describe(
  "parallel writes of several users on DuckDB",
  { timeout: 30_000 },
  () => {
    const getDatabase = useMigratedDatabase();

    async function createServices(): Promise<TaskService> {
      const database = getDatabase();
      const permissions = new PermissionService();
      const users = new UserRepository(database);
      const projects = new ProjectRepository(database);
      const cache = new ServerCache();

      await users.insert({
        displayName: "Administrator",
        id: "user-admin",
        passwordHash: await new PasswordHasher().hash("secret"),
        role: ROLE.ADMIN,
        username: "admin",
      });
      await projects.insert({
        description: "",
        id: "project-1",
        name: "Pages",
        ownerId: "user-admin",
        placeholderColor: "#FCE3D3",
        status: "active",
      });

      return new TaskService(
        new TaskRepository(database),
        new ProjectService(projects, permissions, null, cache),
        permissions,
        cache,
      );
    }

    it("gives every ticket created at the same moment its own number", async () => {
      const taskService = await createServices();
      const actor = (await new UserRepository(getDatabase()).findById(
        "user-admin",
      ))!;

      const created = await Promise.all(
        Array.from({ length: WRITERS }, (_, index) =>
          taskService.create(actor, {
            projectId: "project-1",
            skipGitHubSync: true,
            statusId: "status-todo",
            title: `Ticket ${index}`,
            type: WORK_ITEM_TYPE.TASK,
          }),
        ),
      );

      expect(created.map((item) => item.number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: WRITERS }, (_, index) => index + 1),
      );
      expect(new Set(created.map((item) => item.key)).size).toBe(WRITERS);
    });

    it("moves several tickets into one project at the same moment without clashing keys", async () => {
      const taskService = await createServices();
      const database = getDatabase();
      const actor = (await new UserRepository(database).findById(
        "user-admin",
      ))!;

      await new ProjectRepository(database).insert({
        description: "",
        id: "project-2",
        name: "Tools",
        ownerId: "user-admin",
        placeholderColor: "#FCE3D3",
        status: "active",
      });

      const tickets = [];

      for (let index = 0; index < 6; index += 1) {
        tickets.push(
          await taskService.create(actor, {
            projectId: "project-1",
            skipGitHubSync: true,
            statusId: "status-todo",
            title: `Ticket ${index}`,
            type: WORK_ITEM_TYPE.TASK,
          }),
        );
      }

      const moved = await Promise.all(
        tickets.map((ticket) =>
          taskService.moveToProject(actor, ticket.id, "project-2"),
        ),
      );

      expect(moved.map((item) => item.number).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
      expect(new Set(moved.map((item) => item.key)).size).toBe(6);
    });

    it("lets several users sign in at the same moment, each with an own session", async () => {
      const database = getDatabase();
      const users = new UserRepository(database);
      const hasher = new PasswordHasher();
      const userService = new UserService(users, new PermissionService());
      const authService = new AuthService(
        userService,
        new SessionService(new SessionRepository(database), userService),
        hasher,
        new LoginThrottle(),
      );

      for (let index = 0; index < 6; index += 1) {
        await users.insert({
          displayName: `User ${index}`,
          id: `user-${index}`,
          passwordHash: await hasher.hash("secret"),
          role: ROLE.EMPLOYEE,
          username: `user${index}`,
        });
      }

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          authService.login(`user${index}`, "secret", "Firefox", null),
        ),
      );

      expect(results.every((result) => result?.sessionToken)).toBe(true);
      expect(new Set(results.map((result) => result?.sessionToken)).size).toBe(
        6,
      );
      await expect(
        database.query("SELECT COUNT(DISTINCT user_id) FROM sessions;"),
      ).resolves.toEqual([[6]]);
    });
  },
);
