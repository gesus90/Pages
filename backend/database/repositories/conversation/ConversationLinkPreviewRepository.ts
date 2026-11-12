import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

const PREVIEW_COLUMNS = `
    url,
    title,
    description,
    image_storage_name,
    image_mime_type,
    fetched_at`;

/** What the server keeps of a linked page. */
export interface StoredLinkPreview {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  /** The preview image in the file store; `null` without one. */
  readonly image: {
    readonly storageName: string;
    readonly mimeType: string;
  } | null;
  /** ISO 8601 moment of the fetch; the row counts for 24 hours. */
  readonly fetchedAt: string;
}

function toPreview(row: readonly DatabaseValue[]): StoredLinkPreview {
  const storageName = readNullableTextColumn(row, 3, "image_storage_name");
  return {
    url: readTextColumn(row, 0, "url"),
    title: readTextColumn(row, 1, "title"),
    description: readTextColumn(row, 2, "description"),
    image:
      storageName === null
        ? null
        : {
            storageName,
            mimeType: readTextColumn(row, 4, "image_mime_type"),
          },
    fetchedAt: readTextColumn(row, 5, "fetched_at"),
  };
}

/**
 * The preview data of linked pages (PAGE-298), fetched once per URL and kept
 * for 24 hours; the preview image lies in the file store.
 */
export class ConversationLinkPreviewRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the stored previews of URLs by URL, whatever their age. */
  public async find(
    urls: readonly string[],
  ): Promise<Map<string, StoredLinkPreview>> {
    const previews = new Map<string, StoredLinkPreview>();
    if (urls.length === 0) return previews;
    const list = createInClause("url", urls);
    const rows = await this.database.query(
      `
        SELECT${PREVIEW_COLUMNS}
        FROM conversation_link_previews
        WHERE url IN (${list.placeholders});
      `,
      list.parameters,
    );
    for (const row of rows) {
      const preview = toPreview(row);
      previews.set(preview.url, preview);
    }
    return previews;
  }

  /**
   * Stores what a fetch learned, replacing an older row of the URL.
   *
   * @returns The image name the replaced row listed, or `null`.
   */
  public async save(preview: StoredLinkPreview): Promise<string | null> {
    const [known] = [...(await this.find([preview.url])).values()];
    await this.database.execute(
      `
        INSERT INTO conversation_link_previews (
            url,
            title,
            description,
            image_storage_name,
            image_mime_type,
            fetched_at
        )
        VALUES (
            $url,
            $title,
            $description,
            $image_storage_name,
            $image_mime_type,
            $fetched_at
        )
        ON CONFLICT (url) DO UPDATE
        SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            image_storage_name = EXCLUDED.image_storage_name,
            image_mime_type = EXCLUDED.image_mime_type,
            fetched_at = EXCLUDED.fetched_at;
      `,
      {
        url: preview.url,
        title: preview.title,
        description: preview.description,
        image_storage_name: preview.image?.storageName ?? null,
        image_mime_type: preview.image?.mimeType ?? null,
        fetched_at: preview.fetchedAt,
      },
    );
    return known?.image?.storageName ?? null;
  }

  /** Removes the previews fetched before a moment; returns their image names. */
  public async removeBefore(fetchedBefore: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        DELETE FROM conversation_link_previews
        WHERE fetched_at < $fetched_before
        RETURNING image_storage_name;
      `,
      { fetched_before: fetchedBefore },
    );
    return rows.flatMap((row) => {
      const name = readNullableTextColumn(row, 0, "image_storage_name");
      return name === null ? [] : [name];
    });
  }

  /** Returns every image name the previews still list, for the sweep of the file store. */
  public async storageNames(): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT image_storage_name
        FROM conversation_link_previews
        WHERE image_storage_name IS NOT NULL;
      `,
    );
    return new Set(
      rows.map((row) => readTextColumn(row, 0, "image_storage_name")),
    );
  }
}
