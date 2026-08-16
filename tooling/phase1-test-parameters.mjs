/** Canonical reproducibility parameters for the Phase-1 gates. */
export const PHASE1_TEST_PARAMETERS = Object.freeze({
  database: Object.freeze({
    database: "crip_wallet",
    user: "crip",
  }),
  concurrency: Object.freeze({
    barrier: "ready/start/release",
    barrierTimeoutMs: 5000,
    rounds: 32,
    workers: 4,
  }),
  invariants: Object.freeze({
    eventSequenceSeed: 2026081303,
    malformedInputSeed: 2026081302,
    lifecycleSeed: 2026081301,
    numRuns: 512,
  }),
});
