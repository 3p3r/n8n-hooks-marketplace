/** Max wait for any single UI interaction (Playwright). */
export const E2E_UI_TIMEOUT_MS = 15_000;
/** Max wait for MQTT peer catalogs to appear after all instances are open. */
export const E2E_PEER_SYNC_MS = 30_000;
/** Max wait for harness health / owner setup loops. */
export const E2E_HARNESS_TIMEOUT_MS = 60_000;
/** Poll interval for harness health checks. */
export const E2E_POLL_MS = 250;
/** Max time for filter/list assertions once peers are connected. */
export const E2E_ASSERT_POLL_MS = 3_000;
