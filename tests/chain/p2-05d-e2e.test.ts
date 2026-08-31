import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import {
  hashSimulationEvidence,
  advanceOperationLifecycle,
  persistExecutionEnvelope,
  persistPolicyDecision,
  persistSimulation,
  constructTransferCore,
  createLocalAnvilReadRpc,
  decodeTransferIndependent,
  simulateAndResolveTransfer,
  type LocalFixtureIdentity,
  verifyUntrustedChainEvidence,
  verifyExecutableTransfer,
  verifyTransferCore,
} from "@crip/transaction-pipeline";
import { evaluatePolicy } from "@crip/policy-engine";
import { reserveBudget } from "@crip/budget-ledger";
import { authorizeAutonomous } from "@crip/approvals";
import {
  reconcileLocalChainEvidence,
  spawnExecutionProcess,
} from "@crip/local-anvil-adapter";
import {
  canonicalizeIdempotencyPayload,
  hashExecutionEnvelope,
  type ExecutionEnvelopeV2,
} from "@crip/schemas";
import {
  generateComponentCredential,
  signComponentAction,
} from "@crip/trust-boundary";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import {
  createPhase2Fixture,
  readFixture,
  resetPhase2Anvil,
  verifyFixtureOnChain,
} from "../../tooling/phase2-fixture.mjs";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const runtime = loadLocalRuntime({ root });
const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 4,
});

const transferAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);
const nowSecond = (): string =>
  new Date(Math.floor(Date.now() / 1000) * 1000)
    .toISOString()
    .replace(/\.000Z$/, "Z");
const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(canonicalizeIdempotencyPayload(value as never), "utf8")
    .digest("hex")}`;
const stringifySafe = (value: unknown): string =>
  JSON.stringify(value, (_key, nested) =>
    typeof nested === "bigint" ? nested.toString() : nested,
  );
const operationId = "op_p205d_e2e";
const intentId = "intent_p205d_e2e";
const reservationId = "res_p205d_e2e";
const envelopeId = "env_p205d_e2e_1";
const decisionId = "decision_p205d_e2e";
const authorizationId = "auth_p205d_e2e";
const policyId = "policy_p205d_e2e";
const agentId = "agent_p205d_e2e";
const walletId = "wallet_p205d_e2e";
const budgetId = "budget_p205d_e2e";
const adapterRequestId = "request_p205d_e2e";
const amountAtomic = "123456";
const recipient = "0x000000000000000000000000000000000000c0de" as Address;

const signerCredential = JSON.parse(
  readFileSync(`${root}/.local/signer/credential.json`, "utf8"),
) as {
  credentialId: string;
  componentId: string;
  role: "ADAPTER";
  publicKey: string;
  privateKey: string;
};
const reconcilerCredential = generateComponentCredential({
  credentialId: "credential_p205d_reconciler",
  componentId: "p205d-reconciler",
  role: "RECONCILER",
});

let fixtureDocument = readFixture({ root });
let fixture: LocalFixtureIdentity = {
  fixtureInstanceId: fixtureDocument.fixtureInstanceId,
  chainId: "eip155:31337",
  walletAddress: fixtureDocument.deployer.address as Address,
  tokenAddress: fixtureDocument.token.address as Address,
  rpcUrl: fixtureDocument.chain.rpcUrl,
};
let publicClient: ReturnType<typeof createPublicClient> = createPublicClient({
  chain: {
    id: 31337,
    name: "Crip Wallet Local Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [fixture.rpcUrl] } },
  },
  transport: http(fixture.rpcUrl),
});

const policyForFixture = (currentFixture: LocalFixtureIdentity) =>
  ({
    schemaVersion: "1.0",
    policyId,
    version: 1,
    status: "active",
    subject: { agentId, walletId },
    mode: "autonomous-within-policy",
    validity: {
      notBefore: "2026-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
    },
    chains: { allow: ["eip155:31337"] },
    assets: {
      allow: [
        {
          chainId: "eip155:31337",
          type: "erc20",
          address: currentFixture.tokenAddress,
        },
      ],
    },
    recipients: { allow: [recipient] },
    actions: { allow: ["asset.transfer"] },
    budgets: {
      total: { assetAddress: currentFixture.tokenAddress, atomic: "1000000" },
      perTransaction: { atomic: "500000" },
    },
    networkFees: { maximumPerTransactionAtomic: "1000000000000000" },
    signatures: { personalSign: "deny", typedData: "deny", rawDigest: "deny" },
    transactions: {
      requireSimulation: true,
      denyUnknownCalldata: true,
      denyDelegatecall: true,
      denyUnlimitedApprovals: true,
    },
    enforcement: {
      minimumBudgetGrade: "CONTROL_PLANE",
      minimumRecipientGrade: "CONTROL_PLANE",
    },
  }) as const;
let policy = policyForFixture(fixture);

const audit = (suffix: string) => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType: "system" as const,
  actorId: "p205d-e2e",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});
const correlation = {
  ownerId: "owner_p205d_e2e",
  agentId,
  walletId,
  intentId,
  operationId,
  policyId,
  policyVersion: 1,
};

const reset = async (): Promise<void> => {
  await pool.query(`TRUNCATE execution_economic_effects, chain_transfer_logs,
    chain_receipt_evidence, chain_transaction_evidence, broadcast_attempts,
    signed_transactions, recovery_attempts, operation_recovery_leases,
    reservation_broadcast_evidence, authorization_invalidations,
    authorization_evidence, approval_decisions, approval_requests,
    owner_approval_authentications, audit_events, idempotency_records,
    budget_reservations, budget_accounts, operations, intents,
    policy_decisions, transaction_simulations, execution_envelopes,
    policy_versions, policies, wallets, agents, owners, control_fences,
    trusted_component_credentials, local_chain_fixtures CASCADE`);
};

const seedReferenceData = async (): Promise<void> => {
  const payload = {
    schemaVersion: "1.0",
    intentId,
    idempotencyKey: "p205d-e2e-idempotency",
    agentId,
    walletId,
    chainId: "eip155:31337",
    action: "asset.transfer",
    objective: "P2-05D clean vertical slice",
    asset: {
      type: "erc20",
      address: fixture.tokenAddress,
      symbolHint: "TEST_USDC",
      decimalsHint: 6,
    },
    amount: { atomic: amountAtomic, displayHint: "0.123456" },
    recipient,
    maximumNetworkFee: { asset: "native", atomic: "1000000000000000" },
    notBefore: new Date(Date.now() - 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
    expiresAt: new Date(Date.now() + 600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
    metadata: {},
  } as const;
  await pool.query(
    "INSERT INTO owners (owner_id, display_name) VALUES ('owner_p205d_e2e', 'P2-05D owner')",
  );
  await pool.query(
    "INSERT INTO agents (agent_id, owner_id, display_name) VALUES ($1, 'owner_p205d_e2e', 'P2-05D agent')",
    [agentId],
  );
  await pool.query(
    "INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ($1, 'owner_p205d_e2e', 'P2-05D wallet')",
    [walletId],
  );
  await pool.query(
    "INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ($1, 'owner_p205d_e2e', $2, $3, 'active')",
    [policyId, agentId, walletId],
  );
  await pool.query(
    "INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ($1, 1, $2::jsonb, $3)",
    [policyId, JSON.stringify(policy), sha256(policy)],
  );
  await pool.query(
    "INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash) VALUES ($1, 'p205d-e2e-idempotency', $2, $3, $4, 1, $5::jsonb, $6)",
    [
      intentId,
      agentId,
      walletId,
      policyId,
      JSON.stringify(payload),
      sha256(payload),
    ],
  );
  await pool.query(
    "INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state) VALUES ($1, $2, $3, $4, $5, 1, 'DRAFT')",
    [operationId, intentId, agentId, walletId, policyId],
  );
  await pool.query(
    "INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend) VALUES ($1, $2, $3, $4, 1, $5, 1000000, 1000000, 0, 0)",
    [budgetId, agentId, walletId, policyId, fixture.tokenAddress],
  );
  await pool.query(
    "INSERT INTO control_fences (scope_type, scope_id, state) VALUES ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_p205d_e2e', 'ACTIVE'), ('AGENT', $1, 'ACTIVE'), ('POLICY', $2, 'ACTIVE')",
    [agentId, policyId],
  );
  await pool.query(
    "INSERT INTO trusted_component_credentials (credential_id, component_id, component_role, public_key) VALUES ($1, $2, 'ADAPTER', $3), ($4, $5, 'RECONCILER', $6)",
    [
      signerCredential.credentialId,
      signerCredential.componentId,
      signerCredential.publicKey,
      reconcilerCredential.credentialId,
      reconcilerCredential.componentId,
      reconcilerCredential.publicKey,
    ],
  );
  await pool.query(
    `INSERT INTO local_chain_fixtures
       (fixture_instance_id, checkout_sha, chain_id, genesis_block_hash, token_address, token_code_hash,
        deployment_transaction_hash, deployment_block_number, deployment_block_hash, toolchain)
       VALUES ($1, $2, 'eip155:31337', $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      fixture.fixtureInstanceId,
      checkoutSha,
      fixtureDocument.chain.genesisBlockHash,
      fixture.tokenAddress,
      `0x${fixtureDocument.token.runtimeBytecodeHash.slice(7)}`,
      fixtureDocument.deployment.transactionHash,
      fixtureDocument.deployment.blockNumber,
      fixtureDocument.deployment.blockHash,
      JSON.stringify(fixtureDocument.toolchain),
    ],
  );
  await advanceOperationLifecycle(pool, {
    operationId,
    expected: "DRAFT",
    next: "VALIDATED",
  });
  await advanceOperationLifecycle(pool, {
    operationId,
    expected: "VALIDATED",
    next: "POLICY_PRECHECKED",
  });
  return;
};

beforeAll(async () => {
  await resetPhase2Anvil({ root });
  await createPhase2Fixture({ root });
  fixtureDocument = readFixture({ root });
  fixture = {
    fixtureInstanceId: fixtureDocument.fixtureInstanceId,
    chainId: "eip155:31337",
    walletAddress: fixtureDocument.deployer.address as Address,
    tokenAddress: fixtureDocument.token.address as Address,
    rpcUrl: fixtureDocument.chain.rpcUrl,
  };
  policy = policyForFixture(fixture);
  publicClient = createPublicClient({
    chain: {
      id: 31337,
      name: "Crip Wallet Local Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [fixture.rpcUrl] } },
    },
    transport: http(fixture.rpcUrl),
  });
  await verifyFixtureOnChain({ root, fixture: fixtureDocument });
  await reset();
}, 30_000);
beforeEach(async () => {
  await reset();
  await seedReferenceData();
});
afterAll(async () => {
  await pool.end();
});

const assertOperationState = async (expected: string): Promise<void> => {
  const result = await pool.query<{ current_state: string }>(
    "SELECT current_state FROM operations WHERE operation_id = $1",
    [operationId],
  );
  assert.equal(result.rows[0]?.current_state, expected);
};

test("P2-05D clean autonomous journey uses production writers end to end", async () => {
  await assertOperationState("POLICY_PRECHECKED");
  const intent = (
    await pool.query<{ payload: unknown }>(
      "SELECT payload FROM intents WHERE intent_id = $1",
      [intentId],
    )
  ).rows[0]!.payload as Parameters<typeof constructTransferCore>[0];
  const decision = evaluatePolicy(policy, intent, {
    evaluatedAt: nowSecond(),
    totalSpentAtomic: "0",
    enforcement: { budget: "CONTROL_PLANE", recipient: "CONTROL_PLANE" },
  });
  assert.equal(decision.decision, "ALLOW_AUTONOMOUS", JSON.stringify(decision));
  assert.equal(
    decision.rules.every((rule) => rule.result === "pass"),
    true,
  );

  const core = constructTransferCore(intent, {
    walletAddress: fixture.walletAddress,
    tokenAddress: fixture.tokenAddress,
    chainId: fixture.chainId,
    fixtureInstanceId: fixture.fixtureInstanceId,
    provenance: {
      operationId,
      policyId,
      policyVersion: 1,
      policyDecisionHash: decision.decisionHash,
    },
  });
  await advanceOperationLifecycle(pool, {
    operationId,
    expected: "POLICY_PRECHECKED",
    next: "CONSTRUCTED",
  });
  await assertOperationState("CONSTRUCTED");
  const decoded = decodeTransferIndependent(core.calldata);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  await advanceOperationLifecycle(pool, {
    operationId,
    expected: "CONSTRUCTED",
    next: "DECODED",
  });
  await assertOperationState("DECODED");
  const verifiedCore = verifyTransferCore(intent, core, decoded, {
    walletAddress: fixture.walletAddress,
    tokenAddress: fixture.tokenAddress,
    chainId: fixture.chainId,
    fixtureInstanceId: fixture.fixtureInstanceId,
    provenance: core.provenance,
  });
  assert.equal(verifiedCore.ok, true);
  if (!verifiedCore.ok) return;
  await advanceOperationLifecycle(pool, {
    operationId,
    expected: "DECODED",
    next: "VERIFIED",
  });
  await assertOperationState("VERIFIED");
  const simulationResult = await simulateAndResolveTransfer(
    verifiedCore,
    createLocalAnvilReadRpc({
      rpcUrl: fixture.rpcUrl,
      fixtureInstanceId: fixture.fixtureInstanceId,
    }),
    fixture,
    {
      intentMaximumNetworkFeeAtomic: intent.maximumNetworkFee.atomic,
      policyMaximumNetworkFeeAtomic:
        policy.networkFees.maximumPerTransactionAtomic,
    },
  );
  const exact = verifyExecutableTransfer(
    verifiedCore,
    simulationResult.executable,
    simulationResult.simulation,
    {
      intentMaximumNetworkFeeAtomic: intent.maximumNetworkFee.atomic,
      policyMaximumNetworkFeeAtomic:
        policy.networkFees.maximumPerTransactionAtomic,
    },
  );
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  await persistSimulation(pool, {
    simulationId: `simulation:${operationId}`,
    operationId,
    executable: simulationResult.executable,
    simulation: simulationResult.simulation,
    fixtureInstanceId: fixture.fixtureInstanceId,
  });
  await assertOperationState("SIMULATED");
  await persistPolicyDecision(pool, {
    decisionId,
    operationId,
    decision,
  });
  await assertOperationState("POLICY_FINALIZED");

  const senderTokenBefore = await publicClient.readContract({
    address: fixture.tokenAddress,
    abi: transferAbi,
    functionName: "balanceOf",
    args: [fixture.walletAddress],
  });
  const recipientTokenBefore = await publicClient.readContract({
    address: fixture.tokenAddress,
    abi: transferAbi,
    functionName: "balanceOf",
    args: [recipient],
  });
  const senderNativeBefore = await publicClient.getBalance({
    address: fixture.walletAddress,
  });
  await reserveBudget(pool, {
    budgetId,
    reservationId,
    operationId,
    idempotencyKey: "p205d-e2e-reservation",
    amountAtomic,
    expiresAt: intent.expiresAt,
    idempotencyPayload: { intentId, amountAtomic },
    audit: {
      ...audit("reserve"),
      assertedCorrelation: { ...correlation, reservationId, budgetId },
    },
  });
  await advanceOperationLifecycle(pool, {
    operationId,
    expected: "POLICY_FINALIZED",
    next: "BUDGET_RESERVED",
    audit: audit("budget-reserved"),
  });
  await assertOperationState("BUDGET_RESERVED");

  const unsignedEnvelope = {
    schemaVersion: "2.0" as const,
    envelopeId,
    revision: 1,
    intentId,
    intentHash: (
      await pool.query<{ payload_hash: string }>(
        "SELECT payload_hash FROM intents WHERE intent_id = $1",
        [intentId],
      )
    ).rows[0]!.payload_hash,
    agentId,
    walletId,
    adapterId: "local-anvil",
    adapterVersion: "0.1.0",
    chainId: "eip155:31337" as const,
    from: simulationResult.executable.from,
    to: simulationResult.executable.target,
    value: "0" as const,
    calldata: simulationResult.executable.calldata,
    decodedFunction: "erc20.transfer" as const,
    decodedArguments: {
      assetAddress: fixture.tokenAddress,
      recipient,
      amountAtomic,
    },
    expectedAssetDeltas: simulationResult.simulation.expectedAssetDeltas,
    simulationBlockNumber: simulationResult.simulation.blockNumber,
    simulationBlockHash: simulationResult.simulation.blockHash,
    simulationResultHash: hashSimulationEvidence(simulationResult.simulation),
    nonceStrategy: "pending" as const,
    nonce: simulationResult.executable.nonce,
    transactionType: "eip1559" as const,
    gasLimit: simulationResult.executable.gasLimit,
    maxPriorityFeePerGas: simulationResult.executable.maxPriorityFeePerGas,
    accessList: [] as const,
    maximumFeeConstraints: {
      asset: "native" as const,
      maxFeePerGas: simulationResult.executable.maxFeePerGas,
      maximumNetworkFeeAtomic: intent.maximumNetworkFee.atomic,
    },
    policyId,
    policyVersion: 1,
    policyDecisionHash: decision.decisionHash,
    budgetReservationId: reservationId,
    createdAt: nowSecond(),
    expiresAt: intent.expiresAt,
    riskDecision: "ALLOW" as const,
    approvalRequirement: "none" as const,
  };
  const envelopeWithPlaceholder = {
    ...unsignedEnvelope,
    envelopeHash: `0x${"0".repeat(64)}`,
  };
  const envelope = {
    ...envelopeWithPlaceholder,
    envelopeHash: hashExecutionEnvelope(envelopeWithPlaceholder),
  } as ExecutionEnvelopeV2;
  assert.equal(hashExecutionEnvelope(envelope), envelope.envelopeHash);
  await persistExecutionEnvelope(pool, {
    operationId,
    envelope,
    audit: audit("envelope-finalized"),
  });
  await assertOperationState("ENVELOPE_FINALIZED");
  const authorization = await authorizeAutonomous(
    pool,
    {
      authorizationId,
      operationId,
      reservationId,
      envelopeId,
      envelopeRevision: 1,
      envelopeHash: envelope.envelopeHash as `0x${string}`,
      policyDecisionId: decisionId,
      policyDecisionHash: decision.decisionHash as `0x${string}`,
      idempotencyKey: "p205d-e2e-authorization",
    },
    {
      ...audit("authorize"),
      assertedCorrelation: { ...correlation, reservationId, budgetId },
    },
  );
  assert.equal(authorization.authorizationKind, "AUTONOMOUS_POLICY");

  const execution = await spawnExecutionProcess({
    root,
    ids: { operationId, authorizationId, adapterRequestId },
    timeoutMs: 30_000,
  });
  assert.equal(execution.ok, true, JSON.stringify(execution));
  if (!execution.ok) return;
  assert.equal(execution.broadcastStatus, "ACCEPTED");
  assert.deepEqual(execution.phases, [
    "signing-started",
    "evidence-persisted",
    "broadcast-started",
  ]);

  const tx = await publicClient.getTransaction({
    hash: execution.expectedTransactionHash as `0x${string}`,
  });
  const receipt = await publicClient.getTransactionReceipt({
    hash: execution.expectedTransactionHash as `0x${string}`,
  });
  const blockByNumber = await publicClient.getBlock({
    blockNumber: tx.blockNumber!,
  });
  const blockByHash = await publicClient.getBlock({ blockHash: tx.blockHash! });
  const evidenceTransaction = {
    ...tx,
    chainId: BigInt(tx.chainId ?? 31337),
    nonce: BigInt(tx.nonce),
    transactionIndex:
      tx.transactionIndex === null
        ? undefined
        : BigInt(tx.transactionIndex ?? 0),
  };
  const evidenceReceipt = {
    ...receipt,
    logs: receipt.logs.map((log) => ({
      ...log,
      logIndex: BigInt(log.logIndex ?? 0),
    })),
  };
  const attemptId = execution.broadcastAttemptId;
  const adapterAuth = signComponentAction(signerCredential, "broadcast", {
    reservationId,
    transactionHash: execution.expectedTransactionHash,
    nonce: envelope.nonce,
    receiptReference: `receipt:${attemptId}`,
  });
  const verifyAuth = signComponentAction(reconcilerCredential, "verify", {
    reservationId,
    transactionHash: execution.expectedTransactionHash,
    nonce: envelope.nonce,
    receiptReference: `receipt:${attemptId}`,
  });
  const claimAuth = signComponentAction(
    reconcilerCredential,
    "recovery.claim",
    { attemptId, operationId, reservationId, leaseDurationSeconds: 60 },
  );
  const resolveAuth = signComponentAction(
    reconcilerCredential,
    "recovery.resolve",
    {
      attemptId,
      operationId,
      reservationId,
      leaseVersion: "1",
      outcome: "CONFIRMED",
      reason:
        "matching canonical transaction, receipt, block, and Transfer evidence",
      actualSpendAtomic: amountAtomic,
      proofReference: `receipt:${attemptId}`,
      evidence: {
        transactionHash: execution.expectedTransactionHash,
        nonce: envelope.nonce,
        receiptReference: `receipt:${attemptId}`,
      },
    },
  );
  const verifiedEvidence = verifyUntrustedChainEvidence(
    {
      operationId,
      reservationId,
      envelopeId,
      envelopeRevision: 1,
      envelopeHash: envelope.envelopeHash as `0x${string}`,
      authorizationId,
      fixtureInstanceId: fixture.fixtureInstanceId,
      expectedTransactionHash:
        execution.expectedTransactionHash as `0x${string}`,
      fixture,
      envelope,
    },
    {
      transaction: evidenceTransaction,
      receipt: evidenceReceipt,
      canonicalBlockByNumber: blockByNumber,
      canonicalBlockByHash: blockByHash,
    },
  );
  assert.equal(verifiedEvidence.ok, true, JSON.stringify(verifiedEvidence));
  const reconciliation = await reconcileLocalChainEvidence(pool, {
    expectation: {
      operationId,
      reservationId,
      envelopeId,
      envelopeRevision: 1,
      envelopeHash: envelope.envelopeHash as `0x${string}`,
      authorizationId,
      fixtureInstanceId: fixture.fixtureInstanceId,
      expectedTransactionHash:
        execution.expectedTransactionHash as `0x${string}`,
      fixture,
      envelope,
    },
    evidence: {
      transaction: evidenceTransaction,
      receipt: evidenceReceipt,
      canonicalBlockByNumber: blockByNumber,
      canonicalBlockByHash: blockByHash,
    },
    broadcastEvidence: {
      transactionHash: execution.expectedTransactionHash,
      nonce: envelope.nonce,
      receiptReference: `receipt:${attemptId}`,
    },
    attemptId,
    audits: {
      broadcast: { ...audit("broadcast"), componentAuth: adapterAuth },
      verification: { ...audit("verify"), componentAuth: verifyAuth },
      claim: { ...audit("claim"), componentAuth: claimAuth },
      resolve: { ...audit("resolve"), componentAuth: resolveAuth },
    },
  });
  assert.equal(reconciliation.ok, true);
  if (!reconciliation.ok) return;
  const senderTokenAfter = await publicClient.readContract({
    address: fixture.tokenAddress,
    abi: transferAbi,
    functionName: "balanceOf",
    args: [fixture.walletAddress],
  });
  const recipientTokenAfter = await publicClient.readContract({
    address: fixture.tokenAddress,
    abi: transferAbi,
    functionName: "balanceOf",
    args: [recipient],
  });
  const senderNativeAfter = await publicClient.getBalance({
    address: fixture.walletAddress,
  });
  const nativeFee = receipt.gasUsed * receipt.effectiveGasPrice;
  assert.equal(
    recipientTokenAfter - recipientTokenBefore,
    BigInt(amountAtomic),
  );
  assert.equal(senderTokenBefore - senderTokenAfter, BigInt(amountAtomic));
  assert.equal(senderNativeBefore - senderNativeAfter, nativeFee);
  assert.equal(reconciliation.evidence.nativeFeeAtomic, nativeFee.toString());
  assert.equal(reconciliation.reservation.status, "FINALIZED");
  const budget = await pool.query<{
    allocated: string;
    available: string;
    reserved: string;
    finalized_spend: string;
  }>(
    "SELECT allocated, available, reserved, finalized_spend FROM budget_accounts WHERE budget_id = $1",
    [budgetId],
  );
  const ledger = budget.rows[0]!;
  assert.equal(ledger.reserved, "0");
  assert.equal(
    BigInt(ledger.allocated),
    BigInt(ledger.available) +
      BigInt(ledger.reserved) +
      BigInt(ledger.finalized_spend),
  );
  assert.equal(ledger.finalized_spend, amountAtomic);
  const state = await pool.query<{ current_state: string }>(
    "SELECT current_state FROM operations WHERE operation_id = $1",
    [operationId],
  );
  assert.equal(state.rows[0]?.current_state, "RECONCILED");
  const lifecycle = await pool.query<{ current_state: string }>(
    "SELECT current_state FROM operations WHERE operation_id = $1",
    [operationId],
  );
  assert.equal(lifecycle.rows[0]?.current_state, "RECONCILED");
  const persisted = await pool.query<{ count: string }>(
    `SELECT count(*)::text FROM execution_economic_effects WHERE operation_id = $1`,
    [operationId],
  );
  assert.equal(persisted.rows[0]?.count, "1");
  const leakage = stringifySafe({
    execution,
    reconciliation,
    tx,
    receipt,
    blockByNumber,
    blockByHash,
  });
  assert.equal(leakage.includes(signerCredential.privateKey), false);
  assert.doesNotMatch(leakage, /0x02[0-9a-f]+/i);
});
