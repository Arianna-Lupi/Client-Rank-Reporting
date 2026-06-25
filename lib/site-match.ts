/**
 * Pure site-reference matching (CMD-01 / CMD-04).
 *
 * `/add` and `/remove` accept free-form convenience input ("childrenchic.com",
 * "https://www.childrenchic.com/", "sc-domain:childrenchic.com"). This module
 * normalizes such input to a bare host and resolves it against an authoritative
 * list of canonical GSC `siteUrl` values, NEVER touching the network, env or
 * Redis — so it is exhaustively unit-testable and trivially safe.
 *
 * The canonical `siteUrl` forms coexist in one account: `sc-domain:<host>` and
 * `https://<host>/` URL-prefix entries. See lib/gsc.ts for the GscSite contract.
 */

/**
 * Reduce any site reference to a lowercased bare host. Strips, in order, a
 * leading `sc-domain:`, a leading `https://`/`http://` scheme, a leading `www.`
 * and a single trailing `/`, then lowercases. Pure: no I/O.
 */
export function normalizeSiteRef(input: string): string {
  let host = input.trim();
  host = host.replace(/^sc-domain:/i, '');
  host = host.replace(/^https?:\/\//i, '');
  host = host.replace(/^www\./i, '');
  host = host.replace(/\/$/, '');
  return host.toLowerCase();
}

/** Discriminated result of resolving an input against canonical candidates. */
export type ResolveResult =
  | { kind: 'match'; siteUrl: string }
  | { kind: 'multiple'; candidates: string[] }
  | { kind: 'none' };

/**
 * Resolve a user-typed ref against a list of canonical siteUrls.
 *
 * 1. Exact (case-sensitive) equality on a canonical siteUrl wins outright.
 * 2. Otherwise normalize input and candidates; collect candidates whose
 *    normalized form equals the normalized input. 1 -> match, >1 -> multiple,
 *    0 -> none. This is the locked "exact -> normalized single -> multi -> zero"
 *    precedence.
 */
export function resolveSiteRef(
  input: string,
  candidates: ReadonlyArray<string>,
): ResolveResult {
  // 1. Exact canonical equality short-circuits any normalized ambiguity.
  const exact = candidates.find((c) => c === input);
  if (exact !== undefined) {
    return { kind: 'match', siteUrl: exact };
  }

  // 2. Normalized matching against the same-normalized candidates.
  const target = normalizeSiteRef(input);
  const matches = candidates.filter((c) => normalizeSiteRef(c) === target);
  if (matches.length === 1) {
    return { kind: 'match', siteUrl: matches[0]! };
  }
  if (matches.length > 1) {
    return { kind: 'multiple', candidates: matches };
  }
  return { kind: 'none' };
}
