import { describe, expect, it } from "vitest";

import {
  OPEN_MEDIA_FILTER,
  conversationMediaTab,
  filterMediaFiles,
  filterMediaLinks,
  isMediaExpiringSoon,
  mediaArchiveUrl,
  mediaTabCounts,
} from "@/definition/ConversationMediaOverview";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type {
  ConversationMediaFile,
  ConversationMediaLink,
} from "@/definition/ConversationMediaOverview";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function file(
  id: string,
  overrides: Partial<ConversationAttachment> & { senderId?: string; tab?: ConversationMediaFile["tab"] } = {},
): ConversationMediaFile {
  const { senderId = "igor", tab = "documents", ...attachment } = overrides;
  return {
    tab,
    attachment: { id, name: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", url: `/chat/files/${id}`, ...attachment },
    messageId: `m-${id}`,
    senderId,
    sentAt: "2026-11-15T08:00:00.000Z",
  };
}

const FILES = [
  file("Angebot", { senderId: "igor" }),
  file("Bericht", { senderId: "ed", expiresAt: new Date(NOW + 5 * HOUR).toISOString() }),
  file("Analyse", { senderId: "ed", expiresAt: new Date(NOW + 30 * HOUR).toISOString() }),
  file("Alt", { senderId: "ed", expiresAt: new Date(NOW - HOUR).toISOString() }),
  file("Weg", { senderId: "ed", expiredAt: new Date(NOW - HOUR).toISOString() }),
];

const LINKS: ConversationMediaLink[] = [
  { url: "https://docs.example/a", domain: "docs.example", title: "Handbuch", imageUrl: null, messageId: "m1", senderId: "igor", sentAt: "2026-11-15T08:00:00.000Z" },
  { url: "https://news.example/b", domain: "news.example", title: "", imageUrl: null, messageId: "m2", senderId: "ed", sentAt: "2026-11-15T08:00:00.000Z" },
];

const ids = (files: readonly ConversationMediaFile[]): string[] => files.map((entry) => entry.attachment.id);

describe("tabs, search and filters of Medien & Dateien (PAGE-387)", () => {
  it("sorts files into images, videos, audio, documents (PDF, Office, tables, text) and files", () => {
    const tab = (name: string, mimeType: string, kind: ConversationAttachment["kind"] = "file") =>
      conversationMediaTab({ name, mimeType, kind });
    expect(tab("a.png", "image/png", "image")).toBe("images");
    expect(tab("a.mp4", "video/mp4", "video")).toBe("videos");
    expect(tab("a.ogg", "audio/ogg", "audio")).toBe("audio");
    expect(tab("a.pdf", "application/pdf", "pdf")).toBe("documents");
    expect(tab("a.docx", "application/octet-stream")).toBe("documents");
    expect(tab("a.xls", "application/vnd.ms-excel")).toBe("documents");
    expect(tab("a.csv", "text/csv")).toBe("documents");
    expect(tab("README", "text/plain")).toBe("documents");
    expect(tab("a.zip", "application/zip")).toBe("files");
    expect(tab("a.exe", "application/octet-stream")).toBe("files");
  });

  it("searches file names and link titles, domains and addresses without regard to case", () => {
    expect(ids(filterMediaFiles(FILES, { ...OPEN_MEDIA_FILTER, query: "  BER " }, NOW))).toEqual(["Bericht"]);
    expect(filterMediaLinks(LINKS, { ...OPEN_MEDIA_FILTER, query: "handb" }).map((link) => link.url)).toEqual(["https://docs.example/a"]);
    expect(filterMediaLinks(LINKS, { ...OPEN_MEDIA_FILTER, query: "news" }).map((link) => link.url)).toEqual(["https://news.example/b"]);
  });

  it("filters by sender, person or agent", () => {
    expect(ids(filterMediaFiles(FILES, { ...OPEN_MEDIA_FILTER, senderId: "igor" }, NOW))).toEqual(["Angebot"]);
    expect(filterMediaLinks(LINKS, { ...OPEN_MEDIA_FILTER, senderId: "ed" })).toHaveLength(1);
  });

  it("shows under 'läuft bald ab' only files of agents with less than 24 hours left, and no link", () => {
    expect(isMediaExpiringSoon(FILES[1]?.attachment ?? FILES[0]!.attachment, NOW)).toBe(true);
    expect(ids(filterMediaFiles(FILES, { ...OPEN_MEDIA_FILTER, isExpiringSoon: true }, NOW))).toEqual(["Bericht"]);
    expect(filterMediaLinks(LINKS, { ...OPEN_MEDIA_FILTER, isExpiringSoon: true })).toEqual([]);
    const edge = file("Kante", { expiresAt: new Date(NOW + 24 * HOUR).toISOString() });
    expect(isMediaExpiringSoon(edge.attachment, NOW)).toBe(false);
  });

  it("keeps expired files as placeholders unless they are hidden", () => {
    expect(ids(filterMediaFiles(FILES, OPEN_MEDIA_FILTER, NOW))).toHaveLength(5);
    expect(ids(filterMediaFiles(FILES, { ...OPEN_MEDIA_FILTER, isExpiredHidden: true }, NOW))).toEqual(["Angebot", "Bericht", "Analyse"]);
  });

  it("counts every tab and builds the address of one archive", () => {
    expect(mediaTabCounts([file("a", { tab: "images" }), file("b", { tab: "images" }), file("c")], LINKS)).toEqual({
      images: 2,
      videos: 0,
      audio: 0,
      documents: 1,
      files: 0,
      links: 2,
    });
    expect(mediaArchiveUrl("group-1", ["a", "b"])).toBe("/chat/media/group-1/files.zip?ids=a%2Cb");
  });
});
