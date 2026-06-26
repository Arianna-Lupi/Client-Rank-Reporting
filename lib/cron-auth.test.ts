import { describe, expect, it } from 'vitest';

import { isAuthorizedCron } from './cron-auth.js';

/**
 * Cron authorization tests (SCH-02). Only an exact `Authorization: Bearer
 * <secret>` header authorizes; a missing/wrong/wrong-scheme header and an empty
 * secret all fail. No env, no logging of the secret.
 */
const SECRET = 'cron-secret-abc123';

describe('isAuthorizedCron', () => {
  it('accepts an exact Bearer secret', () => {
    const headers = new Headers({ authorization: `Bearer ${SECRET}` });
    expect(isAuthorizedCron(headers, SECRET)).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(isAuthorizedCron(new Headers({}), SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const headers = new Headers({ authorization: 'Bearer wrong-secret' });
    expect(isAuthorizedCron(headers, SECRET)).toBe(false);
  });

  it('rejects a wrong scheme', () => {
    const headers = new Headers({ authorization: `Basic ${SECRET}` });
    expect(isAuthorizedCron(headers, SECRET)).toBe(false);
  });

  it('never authorizes with an empty secret, even against "Bearer "', () => {
    const headers = new Headers({ authorization: 'Bearer ' });
    expect(isAuthorizedCron(headers, '')).toBe(false);
  });
});
