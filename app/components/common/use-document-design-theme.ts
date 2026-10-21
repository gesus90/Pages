import { useState } from "react";

import { STANDARD_ACTIVE_DESIGN_THEME } from "@/definition/DesignTheme";

import type { ActiveDesignTheme } from "@/definition/DesignTheme";

/**
 * Returns the design theme the document is shown in.
 *
 * @param storedDesignTheme - Design theme from the root loader; `undefined`
 * where the router provides no loader data, for example on a thrown error page.
 *
 * @remarks
 * An error page rendered in the browser keeps the design the document had
 * before, like it keeps the color mode; one the server renders has no earlier
 * design and uses the Standard design.
 */
export function useDocumentDesignTheme(
  storedDesignTheme: ActiveDesignTheme | undefined,
): ActiveDesignTheme {
  const [knownDesignTheme, setKnownDesignTheme] = useState(storedDesignTheme);

  if (
    storedDesignTheme !== undefined &&
    storedDesignTheme !== knownDesignTheme
  ) {
    setKnownDesignTheme(storedDesignTheme);
  }

  return storedDesignTheme ?? knownDesignTheme ?? STANDARD_ACTIVE_DESIGN_THEME;
}
