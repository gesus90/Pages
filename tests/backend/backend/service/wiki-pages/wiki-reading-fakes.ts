import { vi } from "vitest";

import { WikiFeedRepository } from "@/backend/database/repositories/wiki/WikiFeedRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import { WikiStateRepository } from "@/backend/database/repositories/wiki/WikiStateRepository";

import type { RawWikiFeedItem } from "@/backend/database/repositories/wiki/WikiFeedRepository";
import type {
  WikiSearchFilters,
  WikiSearchHit,
} from "@/backend/database/repositories/wiki/WikiSearchRepository";
import type {
  WikiProjectSource,
  WikiTicketSource,
} from "@/backend/database/repositories/wiki/WikiLinkRepository";
import type { WikiPageSummary, WikiVisibilityScope } from "@/definition/Wiki";

/** One call of the search query, to prove which scope and filters it got. */
export interface SearchCall {
  readonly scope: WikiVisibilityScope;
  readonly filters: WikiSearchFilters;
}

/** Canned answers and call records of the reading repositories. */
export class ReadingData {
  /** Favorites, open branches and recent pages by account. */
  public readonly favorites = new Map<string, string[]>();
  public readonly expanded = new Map<string, string[]>();
  public readonly recent = new Map<string, string[]>();
  /** Hits the search query returns. */
  public hits: WikiSearchHit[] = [];
  public readonly searchCalls: SearchCall[] = [];
  /** Items of "For me" and the time the area was last read. */
  public feed: RawWikiFeedItem[] = [];
  public feedReadAt = "1970-01-01 00:00:00";
  public readonly feedMarkedRead: string[] = [];
  public feedToday: string | null = null;
  /** Pages, tickets and projects that link to a page. */
  public linkingPages: WikiPageSummary[] = [];
  public mentioningTickets: WikiTicketSource[] = [];
  public mentioningProjects: WikiProjectSource[] = [];
  /** Ticket and people suggestions of the reference picker. */
  public ticketSuggestions: { key: string; title: string }[] = [];
  public peopleSuggestions: {
    id: string;
    username: string;
    displayName: string;
  }[] = [];
  /** Accounts a page can be handed to. */
  public activeUsers: { id: string; displayName: string }[] = [];
  /** Choices of the anchor dialog. */
  public departments: { id: string; name: string }[] = [];
  public milestones: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
  }[] = [];
  public epics: {
    id: string;
    key: string;
    title: string;
    projectId: string;
    departmentId: string | null;
  }[] = [];
  public readonly choiceProjects: string[][] = [];
}

function idsOf(map: Map<string, string[]>, userId: string): string[] {
  return map.get(userId) ?? [];
}

/** Replaces favorites, open branches and recent pages. */
function installPersonalState(canned: ReadingData): void {
  const proto = WikiStateRepository.prototype;
  vi.spyOn(proto, "listFavoriteIds").mockImplementation(async (userId) =>
    idsOf(canned.favorites, userId),
  );
  vi.spyOn(proto, "listExpandedIds").mockImplementation(async (userId) =>
    idsOf(canned.expanded, userId),
  );
  vi.spyOn(proto, "listRecentIds").mockImplementation(async (userId) =>
    idsOf(canned.recent, userId),
  );
  vi.spyOn(proto, "recordVisit").mockImplementation(async (userId, pageId) => {
    canned.recent.set(userId, [
      pageId,
      ...idsOf(canned.recent, userId).filter((id) => id !== pageId),
    ]);
  });
  vi.spyOn(proto, "setFavorite").mockImplementation(
    async (userId, pageId, isFavorite) => {
      const rest = idsOf(canned.favorites, userId).filter(
        (id) => id !== pageId,
      );
      canned.favorites.set(userId, isFavorite ? [...rest, pageId] : rest);
    },
  );
  vi.spyOn(proto, "setExpanded").mockImplementation(
    async (userId, pageId, isExpanded) => {
      const rest = idsOf(canned.expanded, userId).filter((id) => id !== pageId);
      canned.expanded.set(userId, isExpanded ? [...rest, pageId] : rest);
    },
  );
}

/** Replaces search, feed and the link and account lookups with canned answers. */
function installCannedQueries(canned: ReadingData): void {
  vi.spyOn(WikiSearchRepository.prototype, "search").mockImplementation(
    async (scope, filters) => {
      canned.searchCalls.push({ filters, scope });
      return { hits: canned.hits, total: canned.hits.length };
    },
  );
  vi.spyOn(WikiSearchRepository.prototype, "searchTitles").mockImplementation(
    async (_, query) =>
      canned.hits
        .filter((hit) => hit.title.toLowerCase().includes(query.toLowerCase()))
        .map(({ id, title, icon }) => ({ icon, id, title })),
  );
  vi.spyOn(WikiFeedRepository.prototype, "collect").mockImplementation(
    async (_, today) => {
      canned.feedToday = today;
      return canned.feed;
    },
  );
  vi.spyOn(WikiFeedRepository.prototype, "findReadTime").mockImplementation(
    async () => canned.feedReadAt,
  );
  vi.spyOn(WikiFeedRepository.prototype, "markRead").mockImplementation(
    async (userId) => {
      canned.feedMarkedRead.push(userId);
    },
  );
}

/** Replaces the lookups behind links, anchor choices and references. */
function installLookups(canned: ReadingData): void {
  vi.spyOn(WikiLinkRepository.prototype, "findLinkingPages").mockImplementation(
    async () => canned.linkingPages,
  );
  vi.spyOn(
    WikiLinkRepository.prototype,
    "findTicketsMentioning",
  ).mockImplementation(async () => canned.mentioningTickets);
  vi.spyOn(
    WikiLinkRepository.prototype,
    "findProjectsMentioning",
  ).mockImplementation(async () => canned.mentioningProjects);
  vi.spyOn(
    WikiLookupRepository.prototype,
    "findProjectNames",
  ).mockImplementation(async (projectIds) =>
    projectIds.map((id) => ({ id, name: `Project ${id}` })),
  );
  vi.spyOn(
    WikiLookupRepository.prototype,
    "listActiveUsers",
  ).mockImplementation(async () => canned.activeUsers);
  vi.spyOn(WikiLinkRepository.prototype, "searchTickets").mockImplementation(
    async () => canned.ticketSuggestions,
  );
  vi.spyOn(WikiLookupRepository.prototype, "searchUsers").mockImplementation(
    async () => canned.peopleSuggestions,
  );
  vi.spyOn(
    WikiLookupRepository.prototype,
    "listDepartments",
  ).mockImplementation(async () => canned.departments);
  vi.spyOn(WikiLookupRepository.prototype, "listMilestones").mockImplementation(
    async (projectIds) => {
      canned.choiceProjects.push([...projectIds]);
      return canned.milestones.filter((milestone) =>
        projectIds.includes(milestone.projectId),
      );
    },
  );
  vi.spyOn(WikiLookupRepository.prototype, "listEpics").mockImplementation(
    async (projectIds) =>
      canned.epics.filter((epic) => projectIds.includes(epic.projectId)),
  );
}

/**
 * Installs the canned and personal-state repositories.
 *
 * @param canned - The answers they give and the calls they record.
 */
export function installReadingFakes(canned: ReadingData): void {
  installPersonalState(canned);
  installCannedQueries(canned);
  installLookups(canned);
}
