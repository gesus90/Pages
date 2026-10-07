import type { Label } from "@/definition/Task";

/**
 * Narrows the project labels to those whose name contains the search text.
 *
 * @param labels - Every label of the project.
 * @param query - Search text typed by the visitor; case and outer spaces are ignored.
 * @returns All labels for a blank query, otherwise the matching ones.
 */
export function filterLabels(
  labels: readonly Label[],
  query: string,
): readonly Label[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return labels;
  }

  return labels.filter((label) =>
    label.name.toLowerCase().includes(normalizedQuery),
  );
}
