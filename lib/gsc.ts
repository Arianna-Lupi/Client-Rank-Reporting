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
