/**
 * Shared numeric constants (IN-03).
 *
 * Centralizes spec values that were previously inline literals repeated across
 * the GSC fetch, the weekly-window core, and the tests, so intent is documented
 * in one place and the values cannot drift apart.
 */

/** Milliseconds in one UTC day — the unit for all date shifting. */
export const MS_PER_DAY = 86_400_000;

/** Max per-URL rows requested from GSC's searchanalytics.query (page dimension). */
export const PAGE_ROW_LIMIT = 250;
