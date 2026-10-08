import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { writeSearchParams } from "@/app/lib/wiki-search-params";

import type { WikiSearchResponse } from "@/definition/Wiki";

/** Milliseconds without typing before the search is sent. */
const SEARCH_DELAY = 250;

/** What the person entered in the search dialog. */
export interface WikiSearchForm {
  readonly text: string;
  readonly location: string;
  readonly isUnderPage: boolean;
  readonly creatorId: string;
  readonly editedFrom: string;
  readonly editedTo: string;
  readonly sort: string;
  readonly titleOnly: boolean;
}

/** The empty search form. */
export const EMPTY_SEARCH_FORM: WikiSearchForm = {
  creatorId: "",
  editedFrom: "",
  editedTo: "",
  isUnderPage: false,
  location: "",
  sort: "relevance",
  text: "",
  titleOnly: false,
};

/** The search dialog's form and the answer to it. */
export interface WikiSearchState {
  readonly form: WikiSearchForm;
  readonly setForm: (form: WikiSearchForm) => void;
  /** The answer to the current form; `null` while nothing is searched. */
  readonly response: WikiSearchResponse | null;
  readonly isLoading: boolean;
}

function toQuery(form: WikiSearchForm, pageId: string | null): string {
  return writeSearchParams({
    creatorId: form.creatorId || null,
    editedFrom: form.editedFrom || null,
    editedTo: form.editedTo || null,
    location: form.location || null,
    sort: form.sort,
    text: form.text,
    titleOnly: form.titleOnly,
    underPageId: form.isUnderPage ? pageId : null,
  });
}

/**
 * Holds the search form and sends it a moment after the last change.
 *
 * @param pageId - The open page, for "only in this page"; `null` elsewhere.
 * @returns The form, its setter and the answer.
 */
export function useWikiSearch(pageId: string | null): WikiSearchState {
  const fetcher = useFetcher<WikiSearchResponse>();
  const [form, setForm] = useState<WikiSearchForm>(EMPTY_SEARCH_FORM);
  const query = toQuery(form, pageId);
  const isEmpty = query === toQuery(EMPTY_SEARCH_FORM, pageId);
  const load = fetcher.load;

  useEffect(() => {
    if (isEmpty) {
      return undefined;
    }

    const timer = setTimeout(
      () => void load(`/wiki-api/search?${query}`),
      SEARCH_DELAY,
    );

    return () => clearTimeout(timer);
  }, [isEmpty, load, query]);

  return {
    form,
    isLoading: !isEmpty && fetcher.state !== "idle",
    response: isEmpty ? null : (fetcher.data ?? null),
    setForm,
  };
}
