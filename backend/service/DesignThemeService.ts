import { readFile } from "node:fs/promises";
import path from "node:path";

import { toDesignThemeChoice } from "@/backend/service/design/DesignThemeChoice";
import { STANDARD_DESIGN_THEME_ID } from "@/definition/DesignTheme";

import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { InstalledDesignTheme } from "@/backend/service/design/DesignThemeLoader";
import type { DesignThemeRegistry } from "@/backend/service/design/DesignThemeRegistry";
import type {
  ActiveDesignTheme,
  DesignThemeSelection,
} from "@/definition/DesignTheme";

const PREVIEW_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** A preview image of a theme, ready to be sent. */
export interface DesignThemePreviewImage {
  readonly data: Buffer;
  readonly contentType: string;
}

/** Whether a design theme choice was stored. */
export type DesignThemeSelectResult = "saved" | "unknown";

/**
 * Establishes the business-logic boundary for the personal design theme.
 *
 * @remarks
 * A user stores only the identifier of a theme. Whether that theme is still
 * installed is decided each time it is read, and a theme that is gone makes
 * the Standard design apply without touching the stored identifier, so the
 * choice returns when the theme is installed again. Every method works on the
 * account it is given and on nothing else.
 */
export class DesignThemeService {
  private readonly registry: DesignThemeRegistry;
  private readonly userSettingsRepository: UserSettingsRepository;

  /**
   * Creates a design theme service.
   *
   * @param registry - The installed themes.
   * @param userSettingsRepository - User settings persistence boundary.
   */
  public constructor(
    registry: DesignThemeRegistry,
    userSettingsRepository: UserSettingsRepository,
  ) {
    this.registry = registry;
    this.userSettingsRepository = userSettingsRepository;
  }

  /**
   * Returns the design theme a user's pages are rendered in.
   *
   * @param userId - User identifier.
   * @returns The chosen theme, or the Standard design when none was chosen or
   * the chosen one is no longer installed.
   */
  public async getActiveTheme(userId: string): Promise<ActiveDesignTheme> {
    const theme = await this.findChosenTheme(userId);

    return {
      id: theme?.manifest.id ?? STANDARD_DESIGN_THEME_ID,
      stylesheet: theme?.stylesheet ?? null,
    };
  }

  /**
   * Scans the theme directory and returns what the appearance settings offer.
   *
   * @param userId - User identifier.
   * @param options - `includeSkipped` adds the directories that were refused,
   * which only administrators may see.
   */
  public async getSelection(
    userId: string,
    options: { readonly includeSkipped: boolean },
  ): Promise<DesignThemeSelection> {
    const [catalog, chosenId] = await Promise.all([
      this.registry.list(),
      this.userSettingsRepository.findDesignThemeId(userId),
    ]);
    const selected = catalog.themes.find(
      (theme) => theme.manifest.id === chosenId,
    );

    return {
      selectedId: selected?.manifest.id ?? STANDARD_DESIGN_THEME_ID,
      choices: catalog.themes.map((theme) =>
        toDesignThemeChoice(theme.manifest, this.previewImageUrl(theme)),
      ),
      skipped: options.includeSkipped ? catalog.skipped : [],
    };
  }

  /**
   * Stores the design theme a user has chosen.
   *
   * @param userId - User identifier.
   * @param designThemeId - Identifier of the chosen theme.
   * @returns `unknown` when no installed theme has that identifier; nothing is stored then.
   */
  public async select(
    userId: string,
    designThemeId: string,
  ): Promise<DesignThemeSelectResult> {
    const theme = await this.registry.find(designThemeId);

    if (!theme) {
      return "unknown";
    }

    await this.userSettingsRepository.upsertDesignTheme(
      userId,
      theme.manifest.id,
    );

    return "saved";
  }

  /**
   * Reads the preview image of an installed theme.
   *
   * @param designThemeId - Identifier of the theme.
   * @returns The image, or `null` when the theme or its image does not exist.
   */
  public async readPreviewImage(
    designThemeId: string,
  ): Promise<DesignThemePreviewImage | null> {
    const theme = await this.registry.find(designThemeId);
    const imagePath = theme?.previewImagePath;

    if (!imagePath) {
      return null;
    }

    const contentType =
      PREVIEW_CONTENT_TYPES[path.extname(imagePath).toLowerCase()];

    if (!contentType) {
      return null;
    }

    try {
      return { data: await readFile(imagePath), contentType };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  private async findChosenTheme(
    userId: string,
  ): Promise<InstalledDesignTheme | null> {
    const chosenId =
      await this.userSettingsRepository.findDesignThemeId(userId);

    return chosenId === null ? null : this.registry.find(chosenId);
  }

  private previewImageUrl(theme: InstalledDesignTheme): string | null {
    if (theme.previewImagePath === null) {
      return null;
    }

    // The signature changes with the file, so a replaced image is fetched again.
    return `/design-themes/${theme.manifest.id}/preview?v=${encodeURIComponent(theme.signature)}`;
  }
}
