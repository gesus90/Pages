/** The parts of a shared operation contract used by Pica's native tools. */
export interface PicaToolContract {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
    readonly [key: string]: unknown;
  };
  readonly annotations?: { readonly readOnlyHint?: boolean };
}
