# Crip Wallet Phase-2 Parallel Execution Map

Generated from parent PR #5 at verified head `343de49b1313d47b98a60195f00e8de1636cfd32`; protected CI and Secret Scan were green at generation time. The user has confirmed P2-01 remediation is complete and verified. Finish P2-02 through P2-06, then STOP for a separate S2 acceptance review.

```text
P2-01 stable
  |
  +--> [parallel] P2-02A envelope-v2
  |              P2-02BCD transfer core
  |                    |
  +------------> P2-02 integration
                       |
                     P2-03
                       |
          +------------+------------+
          |                         |
     [parallel] P2-04A DB      P2-04B adapter contract
          |                         |
          +----------> P2-04C signer/integration
                               |
                 +-------------+-------------+
                 |             |             |
            [parallel]     [parallel]     [parallel]
              P2-05A         P2-05B         P2-06A
              broadcast      evidence       fault proxy
                 |             |
                 +-----> P2-05CD integration/E2E
                               |
                    +----------+----------+
                    |                     |
               [parallel]             [parallel]
                 P2-06B                 P2-06C
              crash/ambiguity       substitution/recon
                    |                     |
                    +-------> P2-06D closeout
                                   |
                          EXTERNAL S2 REVIEW
```

### Safe maximum concurrency
- Wave 1: 2 implementation agents.
- Wave 2: 1 agent.
- Wave 3: 2 implementation agents.
- Wave 4: 3 agents.
- Wave 5: 2 adversarial agents.

Integration prompts are mandatory because independent green branches do not prove compatible security contracts.

### Ownership split
- P2-02A: `packages/schemas` envelope v2/hash only.
- P2-02BCD: new transaction-pipeline + viem + constructor/manual decoder/static verifier.
- P2-04A: migration/DB guards.
- P2-04B: provider-neutral adapter contract only.
- P2-05A: persist-before-send broadcast mechanics.
- P2-05B: transaction/receipt/block/log verifier only.
- P2-06A: test-only loopback fault proxy.
- P2-06B/C: separate adversarial test families; P2-06D owns final scripts/CI/docs wiring.
