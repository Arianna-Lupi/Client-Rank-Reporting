import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Dummy env so modules whose cold start calls getConfig() (e.g. the cron
    // entrypoint) load under test. These are non-secret placeholders; individual
    // suites override and resetConfigCache() as needed. No live services.
    env: {
      CRON_SECRET: 'test-cron-secret',
      SLACK_SIGNING_SECRET: 'test-signing',
      SLACK_CHANNEL_ID: 'C0000',
      GSC_SA_KEY_B64: 'eyJ9',
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
      SLACK_BOT_TOKEN: 'xoxb-test',
    },
  },
});
