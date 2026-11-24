import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { logCaughtError } from "@/backend/logging/Logger";

import type { EuroDollarReferenceRate } from "@/definition/AgentSessionPricing";

/** The daily euro reference rates of the ECB, published once per working day. */
const ECB_DAILY_RATES_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

/**
 * How long a successful read stays current. The ECB publishes around 16:00
 * CET, so four reads a day find a new rate within hours.
 */
const REFRESH_INTERVAL_MS = 6 * ONE_HOUR_MS;

/** How long Pages waits after a failed read, so an outage does not slow every view. */
const RETRY_INTERVAL_MS = ONE_HOUR_MS;

const FETCH_TIMEOUT_MS = 10_000;

/**
 * How many days after its working day a kept rate still counts as valid.
 * @remarks
 * The longest regular gap of the ECB is Easter: the rate of Thursday stands
 * until Tuesday afternoon. A rate older than a week means the reads fail for
 * longer than a passing outage, so no rate is offered at all.
 */
const MAXIMUM_RATE_AGE_DAYS = 7;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ECB_RATE_DAY = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/u;
const ECB_USD_RATE = /<Cube\s+currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/u;

/** A rate with the moment Pages read it from the ECB. */
interface StoredReferenceRate extends EuroDollarReferenceRate {
  readonly fetchedAt: string;
}

/** What the reference rate reads with; replaceable to check it without network. */
interface EcbReferenceRateDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/** A rate when the day is a calendar date and the amount a positive number. */
function validRate(
  usdPerEur: unknown,
  date: unknown,
): EuroDollarReferenceRate | null {
  const amount = typeof usdPerEur === "string" ? Number(usdPerEur) : usdPerEur;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    typeof date !== "string" ||
    !CALENDAR_DATE.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
  )
    return null;
  return { usdPerEur: amount, date };
}

/** The US dollar rate and its working day of the ECB's daily file. */
function parseDailyRates(xml: string): EuroDollarReferenceRate | null {
  return validRate(ECB_USD_RATE.exec(xml)?.[1], ECB_RATE_DAY.exec(xml)?.[1]);
}

/** A rate kept in the data directory, or `null` for an unreadable file. */
function parseStored(input: unknown): StoredReferenceRate | null {
  const stored = readAgentObject(input);
  const rate = validRate(stored.usdPerEur, stored.date);
  if (
    !rate ||
    typeof stored.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(stored.fetchedAt))
  )
    return null;
  return { ...rate, fetchedAt: stored.fetchedAt };
}

/**
 * The ECB euro reference rate of the US dollar, read on the server and kept
 * with its working day.
 * @remarks
 * The last valid rate stays in the data directory, so a restart, a weekend
 * or a failed read still converts with it. A new read never replaces a rate
 * of a later working day. Pages sends nothing about its users with a read.
 */
export class EcbReferenceRate {
  private readonly file: string;
  private readonly fetchRates: typeof fetch;
  private readonly now: () => number;
  private kept: StoredReferenceRate | null = null;
  private hasReadFile = false;
  private loading: Promise<void> | null = null;
  private lastAttempt: number | null = null;

  /**
   * Creates the reference rate kept in one file.
   * @param file - The JSON file in the Pages data directory that keeps the last valid rate.
   * @param dependencies - Network access and clock; the global ones by default.
   */
  public constructor(
    file: string,
    dependencies: EcbReferenceRateDependencies = {},
  ) {
    this.file = file;
    this.fetchRates =
      dependencies.fetch ?? (async (input, init) => fetch(input, init));
    this.now = dependencies.now ?? Date.now;
  }

  /**
   * Returns the last valid rate, reading a new one when the kept rate is due.
   * @returns The rate with its working day, or `null` when Pages has none
   * from the last {@link MAXIMUM_RATE_AGE_DAYS} days.
   */
  public async current(): Promise<EuroDollarReferenceRate | null> {
    await this.refresh();
    const kept = this.kept;
    if (!kept) return null;
    const age = this.now() - Date.parse(`${kept.date}T00:00:00Z`);
    if (age > MAXIMUM_RATE_AGE_DAYS * ONE_DAY_MS) return null;
    return { usdPerEur: kept.usdPerEur, date: kept.date };
  }

  private async refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.load();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async load(): Promise<void> {
    await this.readKept();
    const now = this.now();
    if (
      this.kept &&
      now - Date.parse(this.kept.fetchedAt) < REFRESH_INTERVAL_MS
    )
      return;
    if (this.lastAttempt !== null && now - this.lastAttempt < RETRY_INTERVAL_MS)
      return;
    this.lastAttempt = now;
    try {
      await this.keep(await this.read());
    } catch (error: unknown) {
      logCaughtError("EcbReferenceRate", error, "warn");
    }
  }

  private async readKept(): Promise<void> {
    if (this.hasReadFile) return;
    this.hasReadFile = true;
    try {
      this.kept = parseStored(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error: unknown) {
      if (readAgentObject(error).code !== "ENOENT")
        logCaughtError("EcbReferenceRate", error, "warn");
    }
  }

  private async read(): Promise<EuroDollarReferenceRate> {
    const response = await this.fetchRates(ECB_DAILY_RATES_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(`ECB reference rates unavailable (${response.status})`);
    const rate = parseDailyRates(await response.text());
    if (!rate) throw new Error("ECB reference rates name no US dollar rate");
    return rate;
  }

  private async keep(rate: EuroDollarReferenceRate): Promise<void> {
    // A cached answer of an earlier day never replaces a newer kept rate.
    const latest = this.kept && this.kept.date > rate.date ? this.kept : rate;
    this.kept = {
      usdPerEur: latest.usdPerEur,
      date: latest.date,
      fetchedAt: new Date(this.now()).toISOString(),
    };
    // The rate applies at once; a failed write only loses it for a restart.
    await mkdir(path.dirname(this.file), { recursive: true });
    const pending = `${this.file}.pending`;
    await writeFile(pending, JSON.stringify(this.kept), { mode: 0o600 });
    await rename(pending, this.file);
  }
}
