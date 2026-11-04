import { call, prepare, refused, stored } from "./world";

import type { RepositoryFlow } from "./world";

/** The two methods of the wiki facade that are its own; its aggregates belong to `wiki/`. */
export const WIKI_FACADE_FLOW: RepositoryFlow = {
  title: "wiki facade",
  steps: [
    prepare(`
      INSERT INTO wiki_pages (id, author_id, owner_id, title, scope)
      VALUES
          ('page-facade-a', 'user-admin', 'user-admin', 'A', 'instance'),
          ('page-facade-b', 'user-admin', 'user-admin', 'B', 'instance');
    `),
    call("WikiRepository.transaction", ({ wiki }) =>
      wiki.transaction((repository) =>
        repository.activity.insert({
          id: "activity-wiki-facade",
          projectId: "project-a",
          userId: "user-admin",
          category: "wiki",
          action: "page_created",
          message: "Wiki",
        }),
      ),
    ),
    refused("WikiRepository.transaction", ({ wiki }) =>
      wiki.transaction(async (repository) => {
        await repository.activity.insert({
          id: "activity-wiki-facade",
          projectId: "project-a",
          userId: "user-admin",
          category: "wiki",
          action: "page_created",
          message: "Doppelt",
        });
      }),
    ),
    stored(
      "SELECT COUNT(*) FROM project_activity WHERE id = 'activity-wiki-facade';",
    ),
    call("WikiRepository.deletePages", ({ wiki }) =>
      wiki.deletePages({
        sql: "SELECT id FROM wiki_pages WHERE id = $page_id",
        parameters: { page_id: "page-facade-a" },
      }),
    ),
    stored(
      "SELECT id FROM wiki_pages WHERE id LIKE 'page-facade-%' ORDER BY id;",
    ),
    prepare("DELETE FROM wiki_pages WHERE id = 'page-facade-b';"),
  ],
};
