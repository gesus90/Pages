import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { useWikiSearch } from "@/app/components/wiki/use-wiki-search";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiSearchForm } from "@/app/components/wiki/use-wiki-search";
import type {
  WikiNavigation,
  WikiOwnerCandidate,
  WikiSearchResponse,
  WikiSearchResult,
} from "@/definition/Wiki";

interface WikiSearchDialogProps {
  readonly navigation: WikiNavigation;
  readonly people: readonly WikiOwnerCandidate[];
  /** The open page, offered as "only in this page and its subpages". */
  readonly pageId: string | null;
  readonly onClose: () => void;
}

function locationOf(
  result: WikiSearchResult,
  labels: { readonly private: string; readonly general: string },
): string {
  if (result.scope === "private") {
    return labels.private;
  }

  return result.projectName ?? labels.general;
}

function Filters({
  form,
  navigation,
  people,
  pageId,
  onChange,
}: {
  readonly form: WikiSearchForm;
  readonly navigation: WikiNavigation;
  readonly people: readonly WikiOwnerCandidate[];
  readonly pageId: string | null;
  readonly onChange: (form: WikiSearchForm) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const locations = [
    { label: t("wiki.search.locationAll"), value: "" },
    { label: t("wiki.search.locationPrivate"), value: "private" },
    { label: t("wiki.search.locationGeneral"), value: "instance" },
    ...navigation.projects.map((project) => ({
      label: project.name,
      value: `project:${project.id}`,
    })),
  ];
  const creators = [
    { label: t("wiki.search.creatorAll"), value: "" },
    ...people.map((person) => ({
      label: person.displayName,
      value: person.id,
    })),
  ];
  const sorts = ["relevance", "edited", "created"].map((sort) => ({
    label: t(`wiki.search.sort${sort[0]?.toUpperCase()}${sort.slice(1)}`),
    value: sort,
  }));

  return (
    <div className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-2">
      <Select
        ariaLabel={t("wiki.search.location")}
        options={locations}
        value={form.location}
        onValueChange={(location) => onChange({ ...form, location })}
      />
      <Select
        ariaLabel={t("wiki.search.creator")}
        options={creators}
        value={form.creatorId}
        onValueChange={(creatorId) => onChange({ ...form, creatorId })}
      />
      <label className="text-xs font-medium">
        {t("wiki.search.from")}
        <Input
          className="mt-1"
          type="date"
          value={form.editedFrom}
          onChange={(event) =>
            onChange({ ...form, editedFrom: event.target.value })
          }
        />
      </label>
      <label className="text-xs font-medium">
        {t("wiki.search.to")}
        <Input
          className="mt-1"
          type="date"
          value={form.editedTo}
          onChange={(event) =>
            onChange({ ...form, editedTo: event.target.value })
          }
        />
      </label>
      <Select
        ariaLabel={t("wiki.search.sort")}
        options={sorts}
        value={form.sort}
        onValueChange={(sort) => onChange({ ...form, sort })}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.titleOnly}
          onChange={(event) =>
            onChange({ ...form, titleOnly: event.target.checked })
          }
        />
        {t("wiki.search.titleOnly")}
      </label>
      {pageId === null ? null : (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox
            checked={form.isUnderPage}
            onChange={(event) =>
              onChange({ ...form, isUnderPage: event.target.checked })
            }
          />
          {t("wiki.search.underThisPage")}
        </label>
      )}
    </div>
  );
}

function SearchResults({
  response,
  isLoading,
  onClose,
}: {
  readonly response: WikiSearchResponse;
  readonly isLoading: boolean;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const labels = {
    general: t("wiki.nav.generalArea"),
    private: t("wiki.nav.privateArea"),
  };

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {isLoading
          ? t("wiki.search.loading")
          : t("wiki.search.total", { count: response.total })}
      </p>
      {response.results.length === 0 && !isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t("wiki.search.empty")}
        </p>
      ) : null}
      <ul className="space-y-1">
        {response.results.map((result) => (
          <li key={result.id}>
            <Link
              className="block rounded-lg px-3 py-2 hover:bg-muted"
              to={wikiPagePath(result.id, result.title)}
              onClick={onClose}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {result.icon ? `${result.icon} ` : ""}
                  {result.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {locationOf(result, labels)}
                </span>
              </span>
              {result.snippet ? (
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                  {result.snippet}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The search window: text, filters, and hits that only show visible pages. */
export function WikiSearchDialog({
  navigation,
  people,
  pageId,
  onClose,
}: WikiSearchDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const search = useWikiSearch(pageId);
  const [showFilters, setShowFilters] = useState(false);
  const { response } = search;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="overflow-y-auto" size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.search.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.search.description")}
        </DialogDescription>
        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="absolute top-2.5 left-3 size-4 text-muted-foreground"
            />
            <Input
              autoFocus
              aria-label={t("wiki.search.label")}
              className="pl-9"
              placeholder={t("wiki.search.placeholder")}
              value={search.form.text}
              onChange={(event) =>
                search.setForm({ ...search.form, text: event.target.value })
              }
            />
          </div>
          <button
            aria-expanded={showFilters}
            className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-muted"
            type="button"
            onClick={() => setShowFilters(!showFilters)}
          >
            {t("wiki.search.filters")}
          </button>
        </div>
        {showFilters ? (
          <div className="mt-3">
            <Filters
              form={search.form}
              navigation={navigation}
              pageId={pageId}
              people={people}
              onChange={search.setForm}
            />
          </div>
        ) : null}
        <div aria-live="polite" className="mt-4 space-y-2">
          {response === null ? (
            <RecentPages navigation={navigation} onClose={onClose} />
          ) : (
            <SearchResults
              isLoading={search.isLoading}
              response={response}
              onClose={onClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecentPages({
  navigation,
  onClose,
}: {
  readonly navigation: WikiNavigation;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t("wiki.search.recent")}
      </p>
      {navigation.recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("wiki.search.noRecent")}
        </p>
      ) : (
        <ul className="space-y-1">
          {navigation.recent.map((page) => (
            <li key={page.id}>
              <Link
                className="block rounded-lg px-3 py-2 text-sm hover:bg-muted"
                to={wikiPagePath(page.id, page.title)}
                onClick={onClose}
              >
                {page.icon ? `${page.icon} ` : ""}
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
