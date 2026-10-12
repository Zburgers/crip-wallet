import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  verifyUntrustedChainEvidence,
  type ChainEvidenceExpectation,
} from "@crip/transaction-pipeline";
import {
  canonicalExecutionEnvelopeV2Schema,
  type ExecutionEnvelopeV2,
} from "@crip/schemas";
import type {
  AdapterStatusRequest,
  NormalizedChainEvidence,
  NormalizedRecoveryRequest,
  NormalizedStatus,
} from "@crip/adapter-sdk";
import type { Pool } from "pg";
import { createPublicClient, http, type Address } from "viem";

const localChain = {
  id: 31337,
  name: "Crip Wallet Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

type OperationRow = { current_state: string };

type AttemptRow = {
  attempt_id: string;
  status: string;
  operation_id: string;
  reservation_id: string;
  envelope_id: string;
  envelope_revision: number;
  envelope_hash: string;
  authorization_id: string;
  fixture_instance_id: string;
  expected_transaction_hash: string;
  signed_transaction_id: string;
  durable_signed_transaction_id: string | null;
  signed_operation_id: string | null;
  signed_reservation_id: string | null;
  signed_envelope_id: string | null;
  signed_envelope_revision: number | null;
  signed_envelope_hash: string | null;
  signed_authorization_id: string | null;
  signed_fixture_instance_id: string | null;
  signed_expected_transaction_hash: string | null;
  signed_simulation_id: string | null;
  simulation_id: string | null;
  simulation_fixture_instance_id: string | null;
  simulation_sender_address: string | null;
  simulation_chain_id: string | null;
  simulation_evidence_hash: string | null;
  envelope_payload: unknown;
  fixture_id: string | null;
  fixture_chain_id: string | null;
  genesis_block_hash: string | null;
  token_address: string | null;
  token_code_hash: string | null;
};

type Observation = {
  state: NormalizedStatus["state"];
  outcome: NormalizedChainEvidence["outcome"];
  evidence: "UNTRUSTED" | "AUTHENTICATED";
};

const unknown: Observation = {
  state: "UNKNOWN",
  outcome: "UNKNOWN",
  evidence: "UNTRUSTED",
};

const PRE_SEND_STATES = new Set([
  "DRAFT",
  "VALIDATED",
  "POLICY_PRECHECKED",
  "POLICY_FINALIZED",
  "BUDGET_RESERVED",
  "ENVELOPE_FINALIZED",
  "AUTHORIZED",
  "SIGNING",
  "SIGNED",
]);

const operationIsDisputed = (state: string): boolean =>
  !PRE_SEND_STATES.has(state);

const sameBinding = (row: AttemptRow, envelope: ExecutionEnvelopeV2): boolean =>
  row.durable_signed_transaction_id === row.signed_transaction_id &&
  row.signed_operation_id === row.operation_id &&
  row.signed_reservation_id === row.reservation_id &&
  row.signed_envelope_id === row.envelope_id &&
  row.signed_envelope_revision === row.envelope_revision &&
  row.signed_envelope_hash === row.envelope_hash &&
  row.signed_authorization_id === row.authorization_id &&
  row.signed_fixture_instance_id === row.fixture_instance_id &&
  row.signed_expected_transaction_hash === row.expected_transaction_hash &&
  row.signed_simulation_id === row.simulation_id &&
  row.simulation_fixture_instance_id === row.fixture_instance_id &&
  row.simulation_chain_id === "eip155:31337" &&
  row.simulation_sender_address?.toLowerCase() ===
    envelope.from.toLowerCase() &&
  row.simulation_evidence_hash === envelope.simulationResultHash &&
  row.fixture_id === row.fixture_instance_id &&
  row.fixture_chain_id === "eip155:31337" &&
  row.token_address?.toLowerCase() === envelope.to.toLowerCase() &&
  row.envelope_payload !== null &&
  envelope.envelopeId === row.envelope_id &&
  envelope.revision === row.envelope_revision &&
  envelope.envelopeHash === row.envelope_hash;

const readAttempts = async (
  pool: Pool,
  operationId: string,
): Promise<{ state: string | null; attempts: AttemptRow[] }> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const operation = await client.query<OperationRow>(
        "SELECT current_state FROM operations WHERE operation_id = $1",
        [operationId],
      );
      if (!operation.rows[0]) {
        await client.query("COMMIT");
        return { state: null, attempts: [] };
      }
      const attempts = await client.query<AttemptRow>(
        `SELECT a.attempt_id, a.status, a.operation_id, a.reservation_id,
            a.envelope_id, a.envelope_revision, a.envelope_hash,
            a.authorization_id, a.fixture_instance_id,
            a.expected_transaction_hash, a.signed_transaction_id,
            s.signed_transaction_id AS durable_signed_transaction_id,
            s.operation_id AS signed_operation_id,
            s.reservation_id AS signed_reservation_id,
            s.envelope_id AS signed_envelope_id,
            s.envelope_revision AS signed_envelope_revision,
            s.envelope_hash AS signed_envelope_hash,
            s.authorization_id AS signed_authorization_id,
            s.fixture_instance_id AS signed_fixture_instance_id,
            s.expected_transaction_hash AS signed_expected_transaction_hash,
            s.simulation_id AS signed_simulation_id,
            sim.simulation_id,
            sim.fixture_instance_id AS simulation_fixture_instance_id,
            sim.sender_address AS simulation_sender_address,
            sim.chain_id AS simulation_chain_id,
            sim.evidence_hash AS simulation_evidence_hash,
            e.payload AS envelope_payload,
            f.fixture_instance_id AS fixture_id, f.chain_id AS fixture_chain_id,
            f.genesis_block_hash, f.token_address, f.token_code_hash
     FROM broadcast_attempts a
     LEFT JOIN signed_transactions s
       ON s.signed_transaction_id = a.signed_transaction_id
     LEFT JOIN transaction_simulations sim
       ON sim.operation_id = s.operation_id AND sim.simulation_id = s.simulation_id
     LEFT JOIN execution_envelopes e
       ON e.operation_id = a.operation_id AND e.envelope_id = a.envelope_id
      AND e.revision = a.envelope_revision AND e.envelope_hash = a.envelope_hash
     LEFT JOIN local_chain_fixtures f
       ON f.fixture_instance_id = a.fixture_instance_id
     WHERE a.operation_id = $1
     ORDER BY a.created_at, a.attempt_id
     LIMIT 2`,
        [operationId],
      );
      await client.query("COMMIT");
      return {
        state: operation.rows[0].current_state,
        attempts: attempts.rows,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
};

const observeAttempt = async (
  root: string,
  row: AttemptRow,
): Promise<Observation> => {
  const storedConflict =
    row.status === "CONFLICT"
      ? {
          state: "DISPUTED" as const,
          outcome: "CONFLICT" as const,
          evidence: "AUTHENTICATED" as const,
        }
      : unknown;
  const envelopeResult = canonicalExecutionEnvelopeV2Schema.safeParse(
    row.envelope_payload,
  );
  const envelope = envelopeResult.success ? envelopeResult.data : null;
  if (!envelope || !sameBinding(row, envelope))
    return { state: "DISPUTED", outcome: "CONFLICT", evidence: "UNTRUSTED" };
  if (row.status === "REJECTED")
    return { state: "FAILED", outcome: "NOT_FOUND", evidence: "AUTHENTICATED" };

  try {
    const runtimeModule = (await import(
      pathToFileURL(join(resolve(root), "tooling/local-runtime.mjs")).href
    )) as {
      loadLocalRuntime(input: { root: string }): {
        anvil: { rpcUrl: string };
      };
    };
    const rpcUrl = runtimeModule.loadLocalRuntime({ root }).anvil.rpcUrl;
    const rpc = createPublicClient({
      chain: {
        ...localChain,
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl),
    });
    const [chainId, genesis, code] = await Promise.all([
      rpc.getChainId(),
      rpc.getBlock({ blockNumber: 0n }),
      rpc.getCode({ address: row.token_address as Address }),
    ]);
    const codeHash = code
      ? `0x${createHash("sha256").update(code.slice(2), "hex").digest("hex")}`
      : null;
    if (
      chainId !== 31337 ||
      genesis.hash?.toLowerCase() !== row.genesis_block_hash?.toLowerCase() ||
      !code ||
      codeHash !== row.token_code_hash?.toLowerCase()
    )
      return storedConflict;

    const expectedHash = row.expected_transaction_hash as `0x${string}`;
    const transaction = await rpc.getTransaction({ hash: expectedHash });
    if (!transaction) return storedConflict;
    if (transaction.hash.toLowerCase() !== expectedHash.toLowerCase())
      return { state: "DISPUTED", outcome: "CONFLICT", evidence: "UNTRUSTED" };
    if (transaction.blockNumber === null)
      return row.status === "CONFLICT"
        ? storedConflict
        : { state: "PENDING", outcome: "PENDING", evidence: "UNTRUSTED" };
    if (transaction.blockHash === null)
      return { state: "DISPUTED", outcome: "CONFLICT", evidence: "UNTRUSTED" };

    const [receipt, canonicalBlockByNumber, canonicalBlockByHash] =
      await Promise.all([
        rpc.getTransactionReceipt({ hash: expectedHash }),
        rpc.getBlock({ blockNumber: transaction.blockNumber }),
        rpc.getBlock({ blockHash: transaction.blockHash }),
      ]);
    const verification = verifyUntrustedChainEvidence(
      {
        operationId: row.operation_id,
        reservationId: row.reservation_id,
        envelopeId: row.envelope_id,
        envelopeRevision: row.envelope_revision,
        envelopeHash: row.envelope_hash as `0x${string}`,
        authorizationId: row.authorization_id,
        fixtureInstanceId: row.fixture_instance_id,
        expectedTransactionHash: expectedHash,
        fixture: {
          fixtureInstanceId: row.fixture_instance_id,
          chainId: "eip155:31337",
          walletAddress: envelope.from as Address,
          tokenAddress: row.token_address as Address,
          rpcUrl,
        },
        envelope,
      } satisfies ChainEvidenceExpectation,
      {
        transaction: {
          ...transaction,
          chainId: BigInt(transaction.chainId ?? 31337),
          nonce: BigInt(transaction.nonce),
          transactionIndex:
            transaction.transactionIndex === null
              ? undefined
              : BigInt(transaction.transactionIndex ?? 0),
        },
        receipt: {
          ...receipt,
          logs: receipt.logs.map((log) => ({
            ...log,
            logIndex: BigInt(log.logIndex ?? 0),
          })),
        },
        canonicalBlockByNumber,
        canonicalBlockByHash,
      },
    );
    if (!verification.ok)
      return { state: "DISPUTED", outcome: "CONFLICT", evidence: "UNTRUSTED" };
    const state =
      verification.verified.receiptStatus === "SUCCESS"
        ? "CONFIRMED"
        : "FAILED";
    return { state, outcome: state, evidence: "AUTHENTICATED" };
  } catch {
    return storedConflict;
  }
};

export const createLocalRecoveryHandlers = (input: {
  root: string;
  pool: Pool;
}): {
  getStatus(request: AdapterStatusRequest): Promise<NormalizedStatus>;
  recoverTransaction(
    request: NormalizedRecoveryRequest,
  ): Promise<NormalizedChainEvidence>;
} => {
  const inspect = async (operationId: string): Promise<Observation> => {
    const loaded = await readAttempts(input.pool, operationId);
    if (loaded.state === null) return unknown;
    if (loaded.attempts.length === 0) {
      const state = operationIsDisputed(loaded.state) ? "DISPUTED" : "PENDING";
      return {
        state,
        outcome: "NOT_FOUND",
        evidence: "AUTHENTICATED",
      };
    }
    if (loaded.attempts.length !== 1)
      return { state: "DISPUTED", outcome: "CONFLICT", evidence: "UNTRUSTED" };
    return observeAttempt(input.root, loaded.attempts[0]!);
  };

  return {
    getStatus: async (request) => {
      const observation = await inspect(request.operationId);
      return {
        operationId: request.operationId,
        adapterRequestId: request.adapterRequestId,
        state: observation.state,
        evidence: observation.evidence,
      };
    },
    recoverTransaction: async (request) => {
      const observation = await inspect(request.operationId);
      return {
        operationId: request.operationId,
        adapterRequestId: request.adapterRequestId,
        outcome: observation.outcome,
        evidence: observation.evidence,
      };
    },
  };
};
