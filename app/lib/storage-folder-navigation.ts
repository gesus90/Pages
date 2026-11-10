import type { ShouldRevalidateFunctionArgs } from "react-router";

/** The address of the Storage area (PAGE-188). */
const STORAGE_PATH = "/storage";

/**
 * Recognizes a change of folder inside the Storage area (PAGE-279).
 *
 * @remarks
 * The folder is a search parameter of the same page, which loads it itself
 * from `/storage-api`; that endpoint checks session and rights on every call.
 * The frame's data does not depend on the folder. Reading it again would
 * hide the whole page behind the pending destination and delay every folder
 * change. Actions, explicit revalidation, a navigation to the same address
 * and every other navigation still read it.
 */
export function isStorageFolderNavigation({
  currentUrl,
  nextUrl,
  formMethod,
  actionResult,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formMethod !== undefined || actionResult !== undefined) return false;
  if (currentUrl.pathname !== STORAGE_PATH || nextUrl.pathname !== STORAGE_PATH)
    return false;
  const current = new URLSearchParams(currentUrl.searchParams);
  const next = new URLSearchParams(nextUrl.searchParams);
  if (current.get("folder") === next.get("folder")) return false;
  current.delete("folder");
  next.delete("folder");
  return current.toString() === next.toString();
}
