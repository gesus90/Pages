import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";

/**
 * Returns the text as the database would store it, to compare it with a stored text.
 *
 * @param repository - The ticket repository.
 * @param text - The text about to be saved.
 * @returns The stored form. Only a text with U+0000 needs the database to tell.
 */
export async function storedFormOfText(
  repository: Pick<TaskRepository, "storedTextForm">,
  text: string,
): Promise<string> {
  return text.includes("\u0000") ? repository.storedTextForm(text) : text;
}
