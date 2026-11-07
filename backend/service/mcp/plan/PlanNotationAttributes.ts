import { planNotationIssue } from "./PlanNotationIssue";

import type {
  PlanNotationIssue,
  PlanNotationLocation,
} from "./PlanNotationIssue";
import type {
  PlanNotationAttribute,
  PlanNotationValue,
} from "./PlanNotationParser";

/** Where the findings of a reader go. */
export interface PlanNotationFindings {
  readonly issues: PlanNotationIssue[];
}

/**
 * The attributes of one node, frame, edge or of the plan, read once each.
 *
 * @remarks
 * A key given twice, and a short and a long form of the same field, are
 * `duplicate_field`; a key nothing read is `unknown_attribute` once
 * {@link finish} runs. Every finding names the place of its key.
 */
export class PlanNotationAttributes {
  public readonly nodeId: string | null;
  public readonly location: PlanNotationLocation;
  private readonly entries: ReadonlyMap<string, PlanNotationAttribute>;
  private readonly findings: PlanNotationFindings;
  private readonly used = new Set<string>();

  /**
   * Collects the attributes and reports repeated keys.
   *
   * @param attributes - The attributes in the order they were written.
   * @param owner - The node they belong to (`null` for the plan) and where it stands.
   * @param findings - Where findings go.
   */
  public constructor(
    attributes: readonly PlanNotationAttribute[],
    owner: {
      readonly nodeId: string | null;
      readonly location: PlanNotationLocation;
    },
    findings: PlanNotationFindings,
  ) {
    this.nodeId = owner.nodeId;
    this.location = owner.location;
    this.findings = findings;
    const entries = new Map<string, PlanNotationAttribute>();
    for (const attribute of attributes) {
      if (entries.has(attribute.key)) this.report(attribute, "duplicate_field");
      else entries.set(attribute.key, attribute);
    }
    this.entries = entries;
  }

  /** Whether the key was written; asking does not count as reading. */
  public has(key: string): boolean {
    return this.entries.has(key);
  }

  /** The keys that start with a prefix such as `in.`, without the prefix. */
  public suffixes(prefix: string): readonly string[] {
    return [...this.entries.keys()]
      .filter((key) => key.startsWith(prefix) && key.length > prefix.length)
      .map((key) => key.slice(prefix.length));
  }

  /** Reads a value as written, or `undefined` when the key is absent. */
  public value(key: string): PlanNotationValue | undefined {
    const attribute = this.entries.get(key);
    if (attribute) this.used.add(key);
    return attribute?.value;
  }

  /** The place of a key, or of the owner when the key is absent. */
  public at(key: string): PlanNotationLocation {
    return this.entries.get(key) ?? this.location;
  }

  /** Reads a value as text, whatever kind it was written as. */
  public text(key: string): string | undefined {
    return this.value(key)?.text;
  }

  /** Reads a whole number, written as a number or as a text holding one. */
  public integer(key: string): number | undefined {
    const value = this.value(key);
    if (value === undefined) return undefined;
    const number = Number(value.text);
    if (value.text.trim() !== "" && Number.isSafeInteger(number)) return number;
    this.invalid(key);
    return undefined;
  }

  /** Reads one of several fixed words. */
  public choice<Choice extends string>(
    key: string,
    choices: readonly Choice[],
  ): Choice | undefined {
    const text = this.text(key);
    if (text === undefined) return undefined;
    const choice = choices.find((entry) => entry === text);
    if (choice === undefined) this.invalid(key);
    return choice;
  }

  /** Reads `true` or `false`. */
  public boolean(key: string): boolean | undefined {
    const choice = this.choice(key, ["true", "false"]);
    return choice === undefined ? undefined : choice === "true";
  }

  /** Reads JSON written in a text; malformed JSON is `invalid_value`. */
  public json(key: string): unknown {
    const text = this.text(key);
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      this.invalid(key);
      return undefined;
    }
  }

  /**
   * Picks the one form of a field that was written.
   *
   * @param shortKeys - The short forms of the field.
   * @param longKey - Its own name.
   * @returns `short`, `long` or `null` when neither was written; both are
   * `duplicate_field` at the long form, and the field counts as absent.
   */
  public form(
    shortKeys: readonly string[],
    longKey: string,
  ): "short" | "long" | null {
    const isShort = shortKeys.some((key) => this.entries.has(key));
    const isLong = this.entries.has(longKey);
    if (isShort && isLong) {
      this.report(this.at(longKey), "duplicate_field");
      for (const key of [...shortKeys, longKey]) this.used.add(key);
      return null;
    }
    if (isLong) return "long";
    return isShort ? "short" : null;
  }

  /** Reports a value the field does not take. */
  public invalid(key: string): void {
    this.report(this.at(key), "invalid_value");
  }

  /** Reports a finding at a place, for this owner. */
  public report(
    location: PlanNotationLocation,
    code: PlanNotationIssue["code"],
    candidates?: PlanNotationIssue["candidates"],
  ): void {
    this.findings.issues.push(
      planNotationIssue(location, code, this.nodeId, candidates),
    );
  }

  /** Reports every key nothing read as `unknown_attribute`. */
  public finish(): void {
    for (const [key, attribute] of this.entries)
      if (!this.used.has(key)) this.report(attribute, "unknown_attribute");
  }
}
