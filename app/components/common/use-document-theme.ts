import { useState } from "react";
import { useNavigation } from "react-router";

import {
  readSubmittedTheme,
  resolveDocumentTheme,
} from "@/app/lib/document-theme";

import type { UserTheme } from "@/definition/Settings";

/**
 * Returns the theme the document is shown in.
 *
 * @param storedTheme - Theme from the root loader; `undefined` where the
 * router provides no loader data, for example on a thrown error page.
 *
 * @remarks
 * A theme the user just chose applies at once from the pending settings
 * submission, before the server answered. When the save succeeded the loader
 * returns the same theme; a rejected change falls back to the stored theme
 * as soon as the navigation ends. An error page rendered in the browser keeps
 * the theme the document had before; one the server renders has no earlier
 * theme and follows the system.
 */
export function useDocumentTheme(
  storedTheme: UserTheme | undefined,
): UserTheme {
  const navigation = useNavigation();
  const [knownTheme, setKnownTheme] = useState(storedTheme);

  if (storedTheme !== undefined && storedTheme !== knownTheme) {
    setKnownTheme(storedTheme);
  }

  return resolveDocumentTheme(
    storedTheme ?? knownTheme,
    readSubmittedTheme(navigation.formData),
  );
}
