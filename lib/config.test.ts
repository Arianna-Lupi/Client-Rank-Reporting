import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getConfig, resetConfigCache } from './config.js';

/**
 * Config loader tests focused on reportDow (SCH-04 primitive). The full required
 * env is set so getConfig() succeeds; resetConfigCache() clears the memo between
 * env mutations. No secret VALUES are asserted.
 */

const REQUIRED_ENV: Record<string, string> = {
  SLACK_SIGNING_SECRET: 'shhh',
  SLACK_CHANNEL_ID: 'C0000',
  GSC_SA_KEY_B64: 'eyJ9',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
  SLACK_BOT_TOKEN: 'xoxb-test',
  CRON_SECRET: 'cron',
};

beforeEach(() => {
  resetConfigCache();
  for (const [k, v] of Object.entries(REQUIRED_ENV)) {
    process.env[k] = v;
  }
  delete process.env.REPORT_DOW;
});

afterEach(() => {
  resetConfigCache();
  delete process.env.REPORT_DOW;
});

describe('getConfig().reportDow', () => {
  it('defaults to Monday (1) when REPORT_DOW is missing', () => {
    expect(getConfig().reportDow).toBe(1);
  });

  it('honors a valid REPORT_DOW override', () => {
    process.env.REPORT_DOW = '3';
    resetConfigCache();
    expect(getConfig().reportDow).toBe(3);
  });

  it('falls back to Monday (1) on an out-of-range value', () => {
    process.env.REPORT_DOW = '9';
    resetConfigCache();
    expect(getConfig().reportDow).toBe(1);
  });

  it('falls back to Monday (1) on a non-integer value', () => {
    process.env.REPORT_DOW = 'lunes';
    resetConfigCache();
    expect(getConfig().reportDow).toBe(1);
  });
});
