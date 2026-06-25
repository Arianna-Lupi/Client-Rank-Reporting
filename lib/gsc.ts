/**
 * Google Search Console access (GSC-01, GSC-02).
 *
 * Authenticates with a Service Account whose full JSON credential is provided,
 * base64-encoded, in `GSC_SA_KEY_B64` (this avoids the private-key newline
 * escaping bug class entirely — we decode + JSON.parse, never hand-patch the
 * private-key newlines).
 * Lists the account's GSC properties and filters out `siteUnverifiedUser`
 * (properties the Service Account cannot actually read).
 *
 * The canonical `siteUrl` (`sc-domain:` or URL-prefix form) is returned exactly
 * as GSC reports it, so Phase 2's `/add` uses the same string.
 *
 * Source: googleapis searchconsole v1 — github.com/googleapis/google-api-nodejs-client
 */
import { google } from 'googleapis';

import type { DailyMetricRow } from './metrics.js';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

/** Minimal shape of a `sites.list` `siteEntry` element we depend on. */
interface RawSiteEntry {
  siteUrl?: string | null;
  permissionLevel?: string | null;
}

/**
 * Pure filter over raw `siteEntry` results: drops `siteUnverifiedUser` and any
 * entry missing a `siteUrl`/`permissionLevel`, mapping the rest to `GscSite`
 * with the canonical `siteUrl` preserved verbatim. Extracted so it is unit
 * testable without any network or credentials (GSC-02).
 */
export function filterReadableSites(
  entries: ReadonlyArray<RawSiteEntry> | undefined | null,
): GscSite[] {
  return (entries ?? [])
    .filter(
      (e): e is { siteUrl: string; permissionLevel: string } =>
        typeof e.siteUrl === 'string' &&
        typeof e.permissionLevel === 'string' &&
        e.permissionLevel !== 'siteUnverifiedUser',
    )
    .map((e) => ({ siteUrl: e.siteUrl, permissionLevel: e.permissionLevel }));
}

/** Build a GoogleAuth client from the base64-encoded Service Account JSON. */
function getAuth(): InstanceType<typeof google.auth.GoogleAuth> {
  const b64 = process.env.GSC_SA_KEY_B64 ?? '';
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
    client_email: string;
    private_key: string;
  };
  return new google.auth.GoogleAuth({
    credentials: { client_email: json.client_email, private_key: json.private_key },
    scopes: SCOPES,
  });
}

// Initialise the Search Console client lazily at module scope so it is reused
// across warm serverless invocations without crashing on import when env is unset.
let client: ReturnType<typeof google.searchconsole> | undefined;
function getSearchConsole(): ReturnType<typeof google.searchconsole> {
  if (client === undefined) {
    client = google.searchconsole({ version: 'v1', auth: getAuth() });
  }
  return client;
}

/**
 * List the GSC properties readable by the Service Account, excluding
 * `siteUnverifiedUser`. Returns `[]` when the account has no readable
 * properties (e.g. the SA is not yet granted on any property).
 */
export async function listReadableSites(): Promise<GscSite[]> {
  const res = await getSearchConsole().sites.list();
  return filterReadableSites(res.data.siteEntry ?? []);
}

/** Options for {@link fetchDailyMetrics}. See 03-02-PLAN.md <interfaces>. */
export interface FetchDailyOptions {
  windowDays?: number; // default 14
  dataState?: 'final' | 'all'; // default 'final'
}

/** Minimal shape of the searchanalytics.query response rows we depend on. */
export interface RawAnalyticsRow {
  keys?: string[] | null; // keys[0] is the date under dimensions:['date']
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null; // 0-1 fraction
  position?: number | null; // average
}

/** Injectable query fn (DI for tests). Defaults to the real searchconsole client. */
export type GscQueryFn = (params: {
  siteUrl: string;
  requestBody: {
    startDate: string;
    endDate: string;
    dimensions: string[];
    dataState: string;
  };
}) => Promise<{ data: { rows?: RawAnalyticsRow[] | null } }>;

/** Format epoch ms as a 'YYYY-MM-DD' UTC date string. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Default query: a one-line wrapper over the live searchanalytics.query client. */
const defaultQuery: GscQueryFn = (params) => getSearchConsole().searchanalytics.query(params);

/**
 * Fetch per-date metrics for a property over a trailing window (GSC-03).
 *
 * Builds [today-windowDays, today] (UTC; the 14-day window amply covers GSC's
 * 2-3 day lag and resolveComparablePair picks the two most recent days WITH
 * DATA regardless of the exact edge), queries dimensions:['date'] with
 * dataState 'final', maps each row to DailyMetricRow (null fields coalesce to 0,
 * keyless rows skipped), and returns the result sorted ascending by date.
 * Returns [] when GSC yields no rows. The googleapis call is isolated behind the
 * injectable `query` param so the suite runs with a mock — no live API.
 */
export async function fetchDailyMetrics(
  siteUrl: string,
  opts: FetchDailyOptions = {},
  query: GscQueryFn = defaultQuery,
): Promise<DailyMetricRow[]> {
  const windowDays = opts.windowDays ?? 14;
  const dataState = opts.dataState ?? 'final';

  const now = Date.now();
  const endDate = isoDay(now);
  const startDate = isoDay(now - windowDays * 86_400_000);

  const res = await query({
    siteUrl,
    requestBody: { startDate, endDate, dimensions: ['date'], dataState },
  });

  const rows = res.data.rows ?? [];
  return rows
    .map((r): DailyMetricRow | null => {
      const date = r.keys?.[0];
      if (date === undefined || date === '') return null;
      return {
        date,
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      };
    })
    .filter((r): r is DailyMetricRow => r !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
