import { ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { WikiIconPicker } from "@/app/components/wiki/wiki-icon-picker";
import { WikiPageCover } from "@/app/components/wiki/wiki-page-cover";
import { WikiTitleField } from "@/app/components/wiki/wiki-title-field";
import { cn } from "@/app/lib/cn";

import type { WikiPage } from "@/definition/Wiki";

/** The editable parts of the page head, for people who may edit. */
export interface WikiHeroEditing {
  readonly title: string;
  readonly icon: string;
  readonly onTitleChange: (title: string) => void;
  readonly onIconChange: (icon: string) => void;
  /** Continues below the title, in the text. */
  readonly onTitleEnter: () => void;
  readonly onChooseCover: () => void;
}

interface WikiPageHeroProps {
  readonly page: WikiPage;
  readonly editing?: WikiHeroEditing;
}

function HeroActions({
  page,
  editing,
}: {
  readonly page: WikiPage;
  readonly editing: WikiHeroEditing;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex h-8 gap-1 opacity-0 transition-opacity group-focus-within/hero:opacity-100 group-hover/hero:opacity-100 [@media(hover:none)]:opacity-100">
      {editing.icon === "" ? (
        <WikiIconPicker
          value=""
          variant="add"
          onChange={editing.onIconChange}
        />
      ) : null}
      {page.cover === null ? (
        <Button size="xs" variant="ghost" onClick={editing.onChooseCover}>
          <ImagePlus aria-hidden="true" className="size-4" />
          {t("wiki.cover.add")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The head of a wiki page as in Notion: optional cover, large emoji and a
 * prominent title. Editors change all three in place; readers see them.
 */
export function WikiPageHero({
  page,
  editing,
}: WikiPageHeroProps): React.ReactElement {
  const icon = editing ? editing.icon : (page.icon ?? "");

  return (
    <header className="group/hero">
      {page.cover ? (
        <WikiPageCover
          canEdit={editing !== undefined}
          cover={page.cover}
          pageId={page.id}
          onChoose={() => editing?.onChooseCover()}
        />
      ) : null}
      <div
        className={cn(
          "mx-auto w-full max-w-[46rem]",
          page.cover && icon !== "" ? "-mt-10" : "mt-6",
        )}
      >
        {icon !== "" && editing ? (
          <WikiIconPicker value={icon} onChange={editing.onIconChange} />
        ) : null}
        {icon !== "" && !editing ? (
          <span aria-hidden="true" className="block text-6xl leading-none">
            {icon}
          </span>
        ) : null}
        {editing ? <HeroActions editing={editing} page={page} /> : null}
        {editing ? (
          <WikiTitleField
            value={editing.title}
            onChange={editing.onTitleChange}
            onEnter={editing.onTitleEnter}
          />
        ) : (
          <h1 className="pages-selectable mt-2 text-4xl leading-tight font-semibold tracking-tight">
            {page.title}
          </h1>
        )}
      </div>
    </header>
  );
}
