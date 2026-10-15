import { z } from "zod";

/** Orders attempts within the lifetime of one browser document and object. */
export const draftOrderSchema = z.object({
  streamId: z.uuid(),
  sequence: z.number().int().positive(),
});

/** The revision-controlled fields of a wiki edit. */
export const wikiSaveContentSchema = z.object({
  title: z.string(),
  content: z.string(),
  icon: z.string().nullable(),
  revision: z.number().int().positive(),
});

/** Wiki fields confirmed by the server, without unrelated page metadata. */
export type WikiSaveContent = z.infer<typeof wikiSaveContentSchema>;

/** The independently saved text of a ticket. */
export const descriptionContentSchema = z.object({
  description: z.string(),
  updatedAt: z.string(),
});

/** The complete draft of a ticket description. */
export type DescriptionContent = z.infer<typeof descriptionContentSchema>;
