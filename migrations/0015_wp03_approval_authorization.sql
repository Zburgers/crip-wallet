ALTER TABLE execution_envelopes
  ADD CONSTRAINT execution_envelopes_operation_id_key
    UNIQUE (operation_id, envelope_id);

ALTER TABLE policy_decisions
  ADD CONSTRAINT policy_decisions_operation_id_key
    UNIQUE (operation_id, decision_id);

ALTER TABLE budget_reservations
  ADD CONSTRAINT budget_reservations_operation_pair_key
    UNIQUE (operation_id, reservation_id);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_type CHECK (event_type IN (
    'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
    'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
    'budget.reservation.broadcast', 'budget.reservation.evidence.verified',
    'budget.reservation.released', 'budget.reservation.expired', 'budget.reservation.finalized',
    'budget.reservation.disputed', 'operation.state.changed', 'approval.requested',
    'approval.approved', 'approval.consumed', 'approval.rejected', 'approval.expired',
    'approval.revoked', 'signing.started', 'signing.failed', 'transaction.signed',
    'transaction.broadcast', 'transaction.confirmed', 'transaction.reconciled',
    'transaction.reverted', 'operation.disputed', 'agent.revoked', 'system.paused',
    'system.resumed', 'adapter.error'
  ));

CREATE OR REPLACE FUNCTION canonicalize_approval_jsonb(input_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  item record;
  result text;
BEGIN
  CASE jsonb_typeof(input_value)
    WHEN 'null', 'boolean', 'number', 'string' THEN
      RETURN input_value::text;
    WHEN 'array' THEN
      result := '';
      FOR item IN SELECT element FROM jsonb_array_elements(input_value) AS elements(element)
      LOOP
        IF result <> '' THEN result := result || ','; END IF;
        result := result || canonicalize_approval_jsonb(item.element);
      END LOOP;
      RETURN '[' || result || ']';
    WHEN 'object' THEN
      result := '';
      FOR item IN
        SELECT key, value
        FROM jsonb_each(input_value)
        ORDER BY key
      LOOP
        IF result <> '' THEN result := result || ','; END IF;
        result := result || to_jsonb(item.key)::text || ':'
          || canonicalize_approval_jsonb(item.value);
      END LOOP;
      RETURN '{' || result || '}';
  END CASE;
  RAISE EXCEPTION 'unsupported JSON value in canonical envelope';
END;
$$;

CREATE OR REPLACE FUNCTION approval_is_execution_envelope(input_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  key text;
  item jsonb;
  required_keys constant text[] := ARRAY[
    'schemaVersion', 'envelopeId', 'revision', 'intentId', 'intentHash',
    'agentId', 'walletId', 'adapterId', 'adapterVersion', 'chainId', 'from',
    'to', 'value', 'calldata', 'decodedFunction', 'decodedArguments',
    'expectedAssetDeltas', 'simulationBlockReference', 'simulationResultHash',
    'nonceStrategy', 'gasLimit', 'maximumFeeConstraints', 'policyId',
    'policyVersion', 'policyDecisionHash', 'budgetReservationId', 'createdAt',
    'expiresAt', 'riskDecision', 'approvalRequirement', 'envelopeHash'
  ];
  allowed_keys constant text[] := required_keys || ARRAY['supersedesEnvelopeId'];
  identifier_keys constant text[] := ARRAY[
    'envelopeId', 'intentId', 'agentId', 'walletId', 'adapterId', 'policyId',
    'budgetReservationId'
  ];
  evm_hash_keys constant text[] := ARRAY[
    'envelopeHash', 'simulationResultHash', 'policyDecisionHash'
  ];
  address_keys constant text[] := ARRAY['from', 'to'];
  atomic_keys constant text[] := ARRAY['value', 'gasLimit'];
  string_keys constant text[] := ARRAY[
    'schemaVersion', 'intentHash', 'adapterVersion', 'chainId', 'calldata',
    'decodedFunction', 'simulationBlockReference', 'simulationResultHash',
    'nonceStrategy', 'policyDecisionHash', 'createdAt', 'expiresAt',
    'riskDecision', 'approvalRequirement', 'envelopeHash'
  ];
  max_uint256 constant text :=
    '115792089237316195423570985008687907853269984665640564039457584007913129639935';
BEGIN
  IF jsonb_typeof(input_value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  FOREACH key IN ARRAY required_keys LOOP
    IF NOT input_value ? key THEN RETURN false; END IF;
  END LOOP;
  FOR key IN SELECT jsonb_object_keys(input_value) LOOP
    IF NOT key = ANY(allowed_keys) THEN RETURN false; END IF;
  END LOOP;

  IF input_value ->> 'schemaVersion' <> '1.0'
     OR jsonb_typeof(input_value -> 'revision') <> 'number'
     OR input_value ->> 'revision' !~ '^[1-9][0-9]*$'
     OR jsonb_typeof(input_value -> 'policyVersion') <> 'number'
     OR input_value ->> 'policyVersion' !~ '^[1-9][0-9]*$'
     OR input_value ->> 'adapterVersion' !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
     OR input_value ->> 'chainId' !~ '^[a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'
     OR input_value ->> 'calldata' !~ '^0x[0-9a-f]*$'
     OR input_value ->> 'simulationBlockReference' !~ '^(0x[0-9a-f]+|[1-9][0-9]*)$'
     OR input_value ->> 'decodedFunction' <> 'erc20.transfer'
     OR input_value ->> 'nonceStrategy' NOT IN ('pending', 'latest', 'explicit')
     OR input_value ->> 'riskDecision' NOT IN ('ALLOW', 'REVIEW', 'DENY')
     OR input_value ->> 'approvalRequirement' NOT IN ('none', 'owner')
     OR input_value ->> 'intentHash' !~ '^(0x[0-9a-f]{64}|sha256:[0-9a-f]{64})$' THEN
    RETURN false;
  END IF;

  FOREACH key IN ARRAY identifier_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR length(input_value ->> key) NOT BETWEEN 1 AND 128
       OR input_value ->> key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' THEN
      RETURN false;
    END IF;
  END LOOP;
  FOREACH key IN ARRAY string_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
  END LOOP;
  IF input_value ? 'supersedesEnvelopeId' AND (
    jsonb_typeof(input_value -> 'supersedesEnvelopeId') IS DISTINCT FROM 'string'
    OR length(input_value ->> 'supersedesEnvelopeId') NOT BETWEEN 1 AND 128
    OR input_value ->> 'supersedesEnvelopeId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ) THEN
    RETURN false;
  END IF;

  FOREACH key IN ARRAY evm_hash_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR input_value ->> key !~ '^0x[0-9a-f]{64}$' THEN RETURN false; END IF;
  END LOOP;
  FOREACH key IN ARRAY address_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR input_value ->> key !~ '^0x[0-9a-f]{40}$' THEN RETURN false; END IF;
  END LOOP;
  FOREACH key IN ARRAY atomic_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR input_value ->> key !~ '^(0|[1-9][0-9]*)$'
       OR length(input_value ->> key) > 78
       OR (length(input_value ->> key) = 78 AND input_value ->> key > max_uint256) THEN
      RETURN false;
    END IF;
  END LOOP;

  IF input_value ->> 'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
     OR input_value ->> 'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
     OR (input_value ->> 'expiresAt')::timestamptz <= (input_value ->> 'createdAt')::timestamptz THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'decodedArguments') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(input_value -> 'decodedArguments')) <> 3
     OR NOT (input_value -> 'decodedArguments' ?& ARRAY['assetAddress', 'recipient', 'amountAtomic'])
     OR (input_value -> 'decodedArguments') - 'assetAddress' - 'recipient' - 'amountAtomic' <> '{}'::jsonb
     OR jsonb_typeof(input_value -> 'decodedArguments' -> 'assetAddress') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'decodedArguments' -> 'recipient') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'decodedArguments' -> 'amountAtomic') IS DISTINCT FROM 'string'
     OR (input_value -> 'decodedArguments' ->> 'assetAddress') !~ '^0x[0-9a-f]{40}$'
     OR (input_value -> 'decodedArguments' ->> 'recipient') !~ '^0x[0-9a-f]{40}$'
     OR (input_value -> 'decodedArguments' ->> 'amountAtomic') !~ '^(0|[1-9][0-9]*)$'
     OR length(input_value -> 'decodedArguments' ->> 'amountAtomic') > 78
     OR (length(input_value -> 'decodedArguments' ->> 'amountAtomic') = 78
       AND input_value -> 'decodedArguments' ->> 'amountAtomic' > max_uint256) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'maximumFeeConstraints') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(input_value -> 'maximumFeeConstraints')) <> 3
     OR NOT (input_value -> 'maximumFeeConstraints' ?& ARRAY['asset', 'maxFeePerGas', 'maximumNetworkFeeAtomic'])
     OR (input_value -> 'maximumFeeConstraints') - 'asset' - 'maxFeePerGas' - 'maximumNetworkFeeAtomic' <> '{}'::jsonb
     OR jsonb_typeof(input_value -> 'maximumFeeConstraints' -> 'asset') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'maximumFeeConstraints' -> 'maxFeePerGas') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'maximumFeeConstraints' -> 'maximumNetworkFeeAtomic') IS DISTINCT FROM 'string'
     OR input_value -> 'maximumFeeConstraints' ->> 'asset' <> 'native'
     OR input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas' !~ '^(0|[1-9][0-9]*)$'
     OR input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic' !~ '^(0|[1-9][0-9]*)$'
     OR length(input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas') > 78
     OR length(input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic') > 78
     OR (length(input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas') = 78
       AND input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas' > max_uint256)
     OR (length(input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic') = 78
       AND input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic' > max_uint256) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'expectedAssetDeltas') IS DISTINCT FROM 'array'
     OR jsonb_array_length(input_value -> 'expectedAssetDeltas') < 1 THEN
    RETURN false;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input_value -> 'expectedAssetDeltas') AS elements(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
       OR NOT (item ?& ARRAY['assetAddress', 'from', 'to', 'amountAtomic'])
       OR item - 'assetAddress' - 'from' - 'to' - 'amountAtomic' <> '{}'::jsonb
       OR jsonb_typeof(item -> 'assetAddress') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item -> 'from') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item -> 'to') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item -> 'amountAtomic') IS DISTINCT FROM 'string'
       OR item ->> 'assetAddress' !~ '^0x[0-9a-f]{40}$'
       OR item ->> 'from' !~ '^0x[0-9a-f]{40}$'
       OR item ->> 'to' !~ '^0x[0-9a-f]{40}$'
       OR item ->> 'amountAtomic' !~ '^(0|[1-9][0-9]*)$'
       OR length(item ->> 'amountAtomic') > 78
       OR (length(item ->> 'amountAtomic') = 78 AND item ->> 'amountAtomic' > max_uint256) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION approval_bits8(value integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text := '';
  bit_index integer;
BEGIN
  FOR bit_index IN REVERSE 7..0 LOOP
    result := result || CASE WHEN (value >> bit_index) & 1 = 1 THEN '1' ELSE '0' END;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION approval_bit64_from_hex(value text)
RETURNS bit(64)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text := '';
  nibble text;
  bit_index integer;
BEGIN
  IF length(value) <> 16 OR value !~ '^[0-9a-fA-F]+$' THEN
    RAISE EXCEPTION 'invalid 64-bit round constant';
  END IF;
  FOR bit_index IN 1..16 LOOP
    nibble := lower(substr(value, bit_index, 1));
    result := result || CASE nibble
      WHEN '0' THEN '0000' WHEN '1' THEN '0001'
      WHEN '2' THEN '0010' WHEN '3' THEN '0011'
      WHEN '4' THEN '0100' WHEN '5' THEN '0101'
      WHEN '6' THEN '0110' WHEN '7' THEN '0111'
      WHEN '8' THEN '1000' WHEN '9' THEN '1001'
      WHEN 'a' THEN '1010' WHEN 'b' THEN '1011'
      WHEN 'c' THEN '1100' WHEN 'd' THEN '1101'
      WHEN 'e' THEN '1110' WHEN 'f' THEN '1111'
    END;
  END LOOP;
  RETURN result::bit(64);
END;
$$;

CREATE OR REPLACE FUNCTION approval_bit64_not(value bit(64))
RETURNS bit(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT B'1111111111111111111111111111111111111111111111111111111111111111' # value
$$;

CREATE OR REPLACE FUNCTION approval_bit64_rotate(value bit(64), amount integer)
RETURNS bit(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN amount = 0 THEN value ELSE (value << amount) | (value >> (64 - amount)) END
$$;

CREATE OR REPLACE FUNCTION approval_bytea_to_lane(value bytea)
RETURNS bit(64)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text := '';
  byte_index integer;
BEGIN
  IF length(value) <> 8 THEN RAISE EXCEPTION 'Keccak lane must contain eight bytes'; END IF;
  FOR byte_index IN REVERSE 7..0 LOOP
    result := result || approval_bits8(get_byte(value, byte_index));
  END LOOP;
  RETURN result::bit(64);
END;
$$;

CREATE OR REPLACE FUNCTION approval_lane_to_bytea(value bit(64))
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result bytea := decode('', 'hex');
  byte_index integer;
  bit_value text;
  decimal_value integer;
  bit_index integer;
BEGIN
  FOR byte_index IN 0..7 LOOP
    bit_value := substr(value::text, 64 - byte_index * 8 - 7, 8);
    decimal_value := 0;
    FOR bit_index IN 1..8 LOOP
      decimal_value := decimal_value * 2
        + CASE WHEN substr(bit_value, bit_index, 1) = '1' THEN 1 ELSE 0 END;
    END LOOP;
    result := result || decode(lpad(to_hex(decimal_value), 2, '0'), 'hex');
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION approval_keccak256(value bytea)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  rate constant integer := 136;
  padded bytea;
  pad_length integer;
  block_offset integer;
  lane_index integer;
  x integer;
  y integer;
  round integer;
  target integer;
  state bit(64)[] := array_fill(B'0000000000000000000000000000000000000000000000000000000000000000'::bit(64), ARRAY[25]);
  c bit(64)[];
  d bit(64)[];
  b bit(64)[];
  rotations integer[] := ARRAY[
    0, 1, 62, 28, 27,
    36, 44, 6, 55, 20,
    3, 10, 43, 25, 39,
    41, 45, 15, 21, 8,
    18, 2, 61, 56, 14
  ];
  round_constants text[] := ARRAY[
    '0000000000000001', '0000000000008082', '800000000000808a',
    '8000000080008000', '000000000000808b', '0000000080000001',
    '8000000080008081', '8000000000008009', '000000000000008a',
    '0000000000000088', '0000000080008009', '000000008000000a',
    '000000008000808b', '800000000000008b', '8000000000008089',
    '8000000000008003', '8000000000008002', '8000000000000080',
    '000000000000800a', '800000008000000a', '8000000080008081',
    '8000000000008080', '0000000080000001', '8000000080008008'
  ];
  digest bytea := decode('', 'hex');
BEGIN
  pad_length := rate - (coalesce(length(value), 0) % rate);
  padded := coalesce(value, decode('', 'hex'))
    || decode('01', 'hex')
    || decode(repeat('00', pad_length - 1), 'hex');
  padded := set_byte(padded, length(padded) - 1, 128);

  FOR block_offset IN 0..length(padded) - 1 BY rate LOOP
    FOR lane_index IN 0..16 LOOP
      state[lane_index + 1] := state[lane_index + 1] # approval_bytea_to_lane(
        substring(padded FROM block_offset + lane_index * 8 + 1 FOR 8)
      );
    END LOOP;

    FOR round IN 0..23 LOOP
      c := array_fill(B'0000000000000000000000000000000000000000000000000000000000000000'::bit(64), ARRAY[5]);
      d := array_fill(B'0000000000000000000000000000000000000000000000000000000000000000'::bit(64), ARRAY[5]);
      b := array_fill(B'0000000000000000000000000000000000000000000000000000000000000000'::bit(64), ARRAY[25]);

      FOR x IN 0..4 LOOP
        c[x + 1] := state[x + 1];
        FOR y IN 1..4 LOOP
          c[x + 1] := c[x + 1] # state[x + 5 * y + 1];
        END LOOP;
      END LOOP;

      FOR x IN 0..4 LOOP
        d[x + 1] := c[((x + 4) % 5) + 1]
          # approval_bit64_rotate(c[((x + 1) % 5) + 1], 1);
        FOR y IN 0..4 LOOP
          state[x + 5 * y + 1] := state[x + 5 * y + 1] # d[x + 1];
        END LOOP;
      END LOOP;

      FOR x IN 0..4 LOOP
        FOR y IN 0..4 LOOP
          target := y + 5 * ((2 * x + 3 * y) % 5) + 1;
          b[target] := approval_bit64_rotate(
            state[x + 5 * y + 1], rotations[x + 5 * y + 1]
          );
        END LOOP;
      END LOOP;

      FOR x IN 0..4 LOOP
        FOR y IN 0..4 LOOP
          state[x + 5 * y + 1] := b[x + 5 * y + 1]
            # (approval_bit64_not(b[((x + 1) % 5) + 5 * y + 1])
              & b[((x + 2) % 5) + 5 * y + 1]);
        END LOOP;
      END LOOP;

      state[1] := state[1] # approval_bit64_from_hex(round_constants[round + 1]);
    END LOOP;
  END LOOP;

  FOR lane_index IN 0..3 LOOP
    digest := digest || approval_lane_to_bytea(state[lane_index + 1]);
  END LOOP;
  RETURN encode(digest, 'hex');
END;
$$;

CREATE TABLE approval_requests (
  approval_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  policy_decision_id text NOT NULL,
  policy_decision_hash text NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  approver_id text,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  nonce text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  approved_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  consumed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, reservation_id)
    REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id)
    REFERENCES execution_envelopes (operation_id, envelope_id),
  FOREIGN KEY (operation_id, policy_decision_id)
    REFERENCES policy_decisions (operation_id, decision_id),
  UNIQUE (operation_id, envelope_id, envelope_revision),
  CONSTRAINT approval_requests_revision CHECK (envelope_revision > 0),
  CONSTRAINT approval_requests_policy_version CHECK (policy_version > 0),
  CONSTRAINT approval_requests_hash CHECK (
    envelope_hash ~ '^0x[0-9a-f]{64}$' AND
    policy_decision_hash ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT approval_requests_status CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED', 'CONSUMED')
  ),
  CONSTRAINT approval_requests_lifetime CHECK (expires_at > issued_at),
  CONSTRAINT approval_requests_id_format CHECK (
    approval_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    nonce ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  )
);

CREATE TABLE approval_decisions (
  approval_decision_id text PRIMARY KEY,
  approval_id text NOT NULL REFERENCES approval_requests (approval_id),
  decision_type text NOT NULL,
  approver_id text NOT NULL,
  decided_at timestamptz NOT NULL,
  envelope_hash text NOT NULL,
  policy_decision_id text NOT NULL,
  policy_version integer NOT NULL,
  decision_nonce text NOT NULL UNIQUE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_id, decision_type),
  CONSTRAINT approval_decisions_type CHECK (
    decision_type IN ('APPROVE', 'REJECT', 'EXPIRE', 'REVOKE', 'CONSUME')
  ),
  CONSTRAINT approval_decisions_hash CHECK (envelope_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT approval_decisions_policy_version CHECK (policy_version > 0),
  CONSTRAINT approval_decisions_id_format CHECK (
    approval_decision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    decision_nonce ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  )
);

CREATE TABLE authorization_evidence (
  authorization_id text PRIMARY KEY,
  approval_id text NOT NULL UNIQUE REFERENCES approval_requests (approval_id),
  operation_id text NOT NULL,
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  policy_decision_id text NOT NULL,
  policy_decision_hash text NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  approver_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  authorized_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL,
  consumer_id text NOT NULL,
  consumption_nonce text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, reservation_id)
    REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id)
    REFERENCES execution_envelopes (operation_id, envelope_id),
  FOREIGN KEY (operation_id, policy_decision_id)
    REFERENCES policy_decisions (operation_id, decision_id),
  UNIQUE (operation_id),
  CONSTRAINT authorization_evidence_revision CHECK (envelope_revision > 0),
  CONSTRAINT authorization_evidence_policy_version CHECK (policy_version > 0),
  CONSTRAINT authorization_evidence_hash CHECK (
    envelope_hash ~ '^0x[0-9a-f]{64}$' AND
    policy_decision_hash ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT authorization_evidence_lifetime CHECK (
    expires_at > issued_at AND consumed_at >= authorized_at
  ),
  CONSTRAINT authorization_evidence_id_format CHECK (
    authorization_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    consumer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    consumption_nonce ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  )
);

CREATE OR REPLACE FUNCTION enforce_execution_envelope_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  operation_row record;
  previous_envelope_id text;
BEGIN
  SELECT intent_id, agent_id, wallet_id, policy_id, policy_version
  INTO operation_row
  FROM operations
  WHERE operation_id = NEW.operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution envelope operation is missing: %', NEW.operation_id
      USING ERRCODE = '23503';
  END IF;

  IF NOT approval_is_execution_envelope(NEW.payload) THEN
    RAISE EXCEPTION 'execution envelope payload does not match the canonical schema: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ->> 'envelopeId' IS DISTINCT FROM NEW.envelope_id
     OR NEW.payload ->> 'revision' IS DISTINCT FROM NEW.revision::text
     OR NEW.payload ->> 'envelopeHash' IS DISTINCT FROM NEW.envelope_hash
     OR NEW.payload ->> 'intentId' IS DISTINCT FROM operation_row.intent_id
     OR NEW.payload ->> 'agentId' IS DISTINCT FROM operation_row.agent_id
     OR NEW.payload ->> 'walletId' IS DISTINCT FROM operation_row.wallet_id
     OR NEW.payload ->> 'policyId' IS DISTINCT FROM operation_row.policy_id
     OR NEW.payload ->> 'policyVersion' IS DISTINCT FROM operation_row.policy_version::text THEN
    RAISE EXCEPTION 'execution envelope payload does not match operation binding: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM budget_reservations
    WHERE reservation_id = NEW.payload ->> 'budgetReservationId'
      AND operation_id = NEW.operation_id
  ) THEN
    RAISE EXCEPTION 'execution envelope reservation binding is missing: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.envelope_hash IS DISTINCT FROM '0x' || approval_keccak256(
    convert_to('crip/execution-envelopev1', 'UTF8')
      || decode('00', 'hex')
      || convert_to(canonicalize_approval_jsonb(NEW.payload - 'envelopeHash'), 'UTF8')
  ) THEN
    RAISE EXCEPTION 'execution envelope hash is not the canonical hash of its payload: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF (
    EXISTS (
      SELECT 1 FROM approval_requests
      WHERE operation_id = NEW.operation_id
        AND status IN ('PENDING', 'APPROVED')
    ) OR EXISTS (
      SELECT 1 FROM authorization_evidence
      WHERE operation_id = NEW.operation_id
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM operations
    WHERE operation_id = NEW.operation_id
      AND current_state = 'REVALIDATION_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'execution envelope replacement is blocked while authorization exists: %', NEW.operation_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.revision > 1 THEN
    SELECT envelope_id INTO previous_envelope_id
    FROM execution_envelopes
    WHERE operation_id = NEW.operation_id AND revision = NEW.revision - 1;
    IF previous_envelope_id IS NULL
       OR NEW.payload ->> 'supersedesEnvelopeId' IS DISTINCT FROM previous_envelope_id THEN
      RAISE EXCEPTION 'execution envelope revision lineage is invalid: %', NEW.envelope_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER execution_envelopes_binding_guard
  BEFORE INSERT ON execution_envelopes
  FOR EACH ROW EXECUTE FUNCTION enforce_execution_envelope_binding();

CREATE OR REPLACE FUNCTION enforce_approval_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT
    o.policy_id AS operation_policy_id,
    o.policy_version AS operation_policy_version,
    d.decision,
    d.policy_id AS decision_policy_id,
    d.policy_version AS decision_policy_version,
    d.decision_hash,
    o.current_state,
    e.envelope_hash AS persisted_envelope_hash,
    e.revision AS persisted_envelope_revision,
    e.operation_id AS envelope_operation_id,
    e.payload ->> 'policyDecisionHash' AS envelope_decision_hash,
    e.payload ->> 'expiresAt' AS envelope_expires_at,
    r.operation_id AS reservation_operation_id,
    r.status AS reservation_status
  INTO binding
  FROM operations o
  JOIN execution_envelopes e ON e.operation_id = o.operation_id
    AND e.envelope_id = NEW.envelope_id
  JOIN policy_decisions d ON d.operation_id = o.operation_id
    AND d.decision_id = NEW.policy_decision_id
  JOIN budget_reservations r ON r.operation_id = o.operation_id
    AND r.reservation_id = NEW.reservation_id
  WHERE o.operation_id = NEW.operation_id;

  IF NOT FOUND
     OR binding.envelope_operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.reservation_operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.persisted_envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.persisted_envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.decision_hash IS DISTINCT FROM NEW.policy_decision_hash
     OR binding.envelope_decision_hash IS DISTINCT FROM NEW.policy_decision_hash
     OR binding.operation_policy_id IS DISTINCT FROM NEW.policy_id
     OR binding.operation_policy_version IS DISTINCT FROM NEW.policy_version
     OR binding.decision_policy_id IS DISTINCT FROM NEW.policy_id
     OR binding.decision_policy_version IS DISTINCT FROM NEW.policy_version
     OR binding.decision <> 'REQUIRE_APPROVAL'
     OR NEW.expires_at > binding.envelope_expires_at::timestamptz
     OR (
       TG_OP = 'INSERT'
       AND binding.current_state <> 'AWAITING_APPROVAL'
     )
     OR (
       NEW.status IN ('PENDING', 'APPROVED')
       AND (
         binding.current_state <> 'AWAITING_APPROVAL'
         OR binding.reservation_status <> 'HELD'
       )
     )
     OR (
       NEW.status IN ('APPROVED', 'CONSUMED')
       AND binding.envelope_expires_at::timestamptz <= CURRENT_TIMESTAMP
     )
     OR (
       NEW.status IN ('APPROVED', 'CONSUMED')
       AND (
         NEW.issued_at > CURRENT_TIMESTAMP
         OR NEW.expires_at <= CURRENT_TIMESTAMP
       )
     )
     OR (
       NEW.status = 'CONSUMED'
       AND (
         binding.current_state <> 'AUTHORIZED'
         OR binding.reservation_status <> 'AUTHORIZED'
       )
     )
     OR (
       NEW.status = 'REJECTED'
       AND (
         binding.current_state <> 'REJECTED'
         OR binding.reservation_status <> 'RELEASED'
       )
     )
     OR (
       NEW.status = 'EXPIRED'
       AND (
         binding.current_state <> 'EXPIRED'
         OR binding.reservation_status <> 'EXPIRED'
       )
     )
     OR (
       NEW.status = 'REVOKED'
       AND (
         binding.current_state NOT IN ('REVOKED', 'REVALIDATION_REQUIRED')
         OR binding.reservation_status <> 'RELEASED'
       )
     ) THEN
    RAISE EXCEPTION 'approval binding does not match authoritative operation, decision, envelope, or reservation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_requests_binding_guard
  BEFORE INSERT OR UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_binding();

CREATE OR REPLACE FUNCTION enforce_approval_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
       OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
       OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
       OR NEW.envelope_id IS DISTINCT FROM OLD.envelope_id
       OR NEW.envelope_revision IS DISTINCT FROM OLD.envelope_revision
       OR NEW.envelope_hash IS DISTINCT FROM OLD.envelope_hash
       OR NEW.policy_decision_id IS DISTINCT FROM OLD.policy_decision_id
       OR NEW.policy_decision_hash IS DISTINCT FROM OLD.policy_decision_hash
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.nonce IS DISTINCT FROM OLD.nonce THEN
      RAISE EXCEPTION 'approval binding is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;

    IF NEW.status = 'PENDING' AND NEW.approver_id IS NOT NULL THEN
      RAISE EXCEPTION 'pending approval cannot carry approver identity: %', NEW.approval_id
        USING ERRCODE = '23514';
    END IF;
    IF OLD.approver_id IS NOT NULL
       AND NEW.approver_id IS DISTINCT FROM OLD.approver_id THEN
      RAISE EXCEPTION 'approval approver identity is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.approved_at IS NOT NULL
       AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'approval decision timestamp is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.rejected_at IS NOT NULL
       AND NEW.rejected_at IS DISTINCT FROM OLD.rejected_at THEN
      RAISE EXCEPTION 'approval rejection timestamp is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.expired_at IS NOT NULL
       AND NEW.expired_at IS DISTINCT FROM OLD.expired_at THEN
      RAISE EXCEPTION 'approval expiry timestamp is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.revoked_at IS NOT NULL
       AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'approval revocation timestamp is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.consumed_at IS NOT NULL
       AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
      RAISE EXCEPTION 'approval consumption timestamp is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.status NOT IN ('PENDING', 'APPROVED')
       AND NEW.reason IS DISTINCT FROM OLD.reason THEN
      RAISE EXCEPTION 'approval reason is immutable: %', NEW.approval_id
        USING ERRCODE = '55000';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED')) OR
      (OLD.status = 'APPROVED' AND NEW.status IN ('CONSUMED', 'EXPIRED', 'REVOKED'))
    ) THEN
      RAISE EXCEPTION 'invalid approval transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('APPROVED', 'REJECTED', 'REVOKED', 'CONSUMED')
     AND NEW.approver_id IS NULL THEN
    RAISE EXCEPTION 'approval approver identity is required: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'APPROVED' AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'approved timestamp is required: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'REJECTED' AND NEW.rejected_at IS NULL THEN
    RAISE EXCEPTION 'rejected timestamp is required: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'EXPIRED' AND NEW.expired_at IS NULL THEN
    RAISE EXCEPTION 'expired timestamp is required: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'REVOKED' AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'revoked timestamp is required: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CONSUMED' AND NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'consumed timestamp is required: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_requests_transition_guard
  BEFORE INSERT OR UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_transition();

CREATE OR REPLACE FUNCTION enforce_approval_decision_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approval_row record;
BEGIN
  SELECT envelope_hash, policy_decision_id, policy_version, approver_id
  INTO approval_row
  FROM approval_requests
  WHERE approval_id = NEW.approval_id;
  IF NOT FOUND
     OR approval_row.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR approval_row.policy_decision_id IS DISTINCT FROM NEW.policy_decision_id
     OR approval_row.policy_version IS DISTINCT FROM NEW.policy_version
     OR (
       NEW.decision_type NOT IN ('EXPIRE', 'REVOKE')
       AND approval_row.approver_id IS DISTINCT FROM NEW.approver_id
     ) THEN
    RAISE EXCEPTION 'approval decision binding mismatch: %', NEW.approval_decision_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_decisions_binding_guard
  BEFORE INSERT ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_decision_binding();

CREATE TRIGGER approval_decisions_are_immutable
  BEFORE UPDATE OR DELETE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

CREATE OR REPLACE FUNCTION enforce_authorization_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT
    a.operation_id,
    a.reservation_id,
    a.envelope_id,
    a.envelope_revision,
    a.envelope_hash,
    a.policy_decision_id,
    a.policy_decision_hash,
    a.policy_id,
    a.policy_version,
    a.approver_id,
    a.issued_at,
    a.expires_at,
    a.status
  INTO binding
  FROM approval_requests a
  WHERE a.approval_id = NEW.approval_id;

  IF NOT FOUND
     OR binding.status NOT IN ('APPROVED', 'CONSUMED')
     OR binding.operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.reservation_id IS DISTINCT FROM NEW.reservation_id
     OR binding.envelope_id IS DISTINCT FROM NEW.envelope_id
     OR binding.envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.policy_decision_id IS DISTINCT FROM NEW.policy_decision_id
     OR binding.policy_decision_hash IS DISTINCT FROM NEW.policy_decision_hash
     OR binding.policy_id IS DISTINCT FROM NEW.policy_id
     OR binding.policy_version IS DISTINCT FROM NEW.policy_version
     OR binding.approver_id IS DISTINCT FROM NEW.approver_id
     OR binding.issued_at IS DISTINCT FROM NEW.issued_at
     OR binding.expires_at IS DISTINCT FROM NEW.expires_at
     OR binding.expires_at <= CURRENT_TIMESTAMP
     OR NEW.authorized_at < binding.issued_at
     OR NEW.authorized_at >= binding.expires_at
     OR NEW.consumed_at < NEW.authorized_at
     OR NEW.consumed_at >= binding.expires_at THEN
    RAISE EXCEPTION 'authorization evidence binding mismatch: %', NEW.authorization_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authorization_evidence_binding_guard
  BEFORE INSERT ON authorization_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_authorization_binding();

CREATE TRIGGER authorization_evidence_is_immutable
  BEFORE UPDATE OR DELETE ON authorization_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

CREATE OR REPLACE FUNCTION assert_approval_operation_consistency(target_operation_id text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  operation_state text;
  reservation_status text;
  active_count integer;
  consumed_count integer;
  evidence_count integer;
  approval_row record;
  audit_count integer;
BEGIN
  SELECT current_state INTO operation_state
  FROM operations WHERE operation_id = target_operation_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT status INTO reservation_status
  FROM budget_reservations WHERE operation_id = target_operation_id;

  SELECT
    count(*) FILTER (WHERE status IN ('PENDING', 'APPROVED'))::integer,
    count(*) FILTER (WHERE status = 'CONSUMED')::integer
  INTO active_count, consumed_count
  FROM approval_requests
  WHERE operation_id = target_operation_id;

  SELECT count(*)::integer INTO evidence_count
  FROM authorization_evidence
  WHERE operation_id = target_operation_id;

  IF evidence_count <> consumed_count THEN
    RAISE EXCEPTION 'authorization evidence count does not match consumed approvals: %', target_operation_id
      USING ERRCODE = '23514';
  END IF;

  FOR approval_row IN
    SELECT approval_id, reservation_id, status, envelope_id, envelope_revision,
           envelope_hash, policy_decision_id, policy_decision_hash,
           policy_version, issued_at, expires_at
    FROM approval_requests
    WHERE operation_id = target_operation_id
  LOOP
    SELECT count(*)::integer INTO audit_count
    FROM audit_events
    WHERE operation_id = target_operation_id
      AND data ->> 'approvalId' = approval_row.approval_id
      AND data ->> 'reservationId' = approval_row.reservation_id
      AND data ->> 'envelopeId' = approval_row.envelope_id
      AND data ->> 'envelopeRevision' = approval_row.envelope_revision::text
      AND data ->> 'envelopeHash' = approval_row.envelope_hash
      AND data ->> 'policyDecisionId' = approval_row.policy_decision_id
      AND data ->> 'policyDecisionHash' = approval_row.policy_decision_hash
      AND data ->> 'policyVersion' = approval_row.policy_version::text
      AND data ->> 'issuedAt' = to_char(approval_row.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      AND data ->> 'expiresAt' = to_char(approval_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      AND event_type = CASE approval_row.status
        WHEN 'PENDING' THEN 'approval.requested'
        WHEN 'APPROVED' THEN 'approval.approved'
        WHEN 'REJECTED' THEN 'approval.rejected'
        WHEN 'EXPIRED' THEN 'approval.expired'
        WHEN 'REVOKED' THEN 'approval.revoked'
        WHEN 'CONSUMED' THEN 'approval.consumed'
      END;
    IF audit_count <> 1 THEN
      RAISE EXCEPTION 'approval state lacks exactly one matching audit event: %', approval_row.approval_id
        USING ERRCODE = '23514';
    END IF;
    IF approval_row.status = 'CONSUMED' AND NOT EXISTS (
      SELECT 1
      FROM audit_events ae
      JOIN authorization_evidence evidence
        ON evidence.approval_id = approval_row.approval_id
      WHERE ae.operation_id = target_operation_id
        AND ae.event_type = 'approval.consumed'
        AND ae.data ->> 'approvalId' = approval_row.approval_id
        AND ae.data ->> 'authorizationId' = evidence.authorization_id
        AND ae.data ->> 'consumerId' = evidence.consumer_id
        AND ae.data ->> 'consumptionNonce' = evidence.consumption_nonce
        AND ae.data ->> 'approverId' = evidence.approver_id
        AND ae.data ->> 'authorizedAt' = to_char(evidence.authorized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        AND ae.data ->> 'consumedAt' = to_char(evidence.consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) THEN
      RAISE EXCEPTION 'consumed approval lacks complete authorization audit evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    END IF;
    IF approval_row.status = 'APPROVED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'APPROVE'
    ) THEN
      RAISE EXCEPTION 'approved approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'REJECTED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'REJECT'
    ) THEN
      RAISE EXCEPTION 'rejected approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'EXPIRED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'EXPIRE'
    ) THEN
      RAISE EXCEPTION 'expired approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'REVOKED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'REVOKE'
    ) THEN
      RAISE EXCEPTION 'revoked approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'CONSUMED' AND (
      NOT EXISTS (
        SELECT 1 FROM approval_decisions
        WHERE approval_id = approval_row.approval_id AND decision_type = 'APPROVE'
      ) OR NOT EXISTS (
        SELECT 1 FROM approval_decisions
        WHERE approval_id = approval_row.approval_id AND decision_type = 'CONSUME'
      )
    ) THEN
      RAISE EXCEPTION 'consumed approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF operation_state = 'AWAITING_APPROVAL' THEN
    IF active_count <> 1 OR reservation_status IS DISTINCT FROM 'HELD' THEN
      RAISE EXCEPTION 'approval state requires one active approval and held reservation: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state = 'AUTHORIZED' THEN
    IF active_count <> 0
       OR consumed_count <> 1
       OR evidence_count <> 1
       OR reservation_status IS DISTINCT FROM 'AUTHORIZED' THEN
      RAISE EXCEPTION 'authorized operation lacks coherent consumed approval and reservation: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM audit_events
      WHERE operation_id = target_operation_id
        AND event_type = 'budget.reservation.authorized'
    ) THEN
      RAISE EXCEPTION 'authorized operation lacks reservation audit evidence: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state = 'ENVELOPE_FINALIZED' THEN
    IF active_count <> 0 OR consumed_count <> 0 OR evidence_count <> 0
       OR reservation_status IS DISTINCT FROM 'HELD' THEN
      RAISE EXCEPTION 'envelope-finalized operation lacks a held reservation or retains approval state: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state IN ('REVALIDATION_REQUIRED', 'REJECTED', 'EXPIRED', 'REVOKED') THEN
    IF active_count <> 0
       OR (operation_state = 'REVALIDATION_REQUIRED' AND consumed_count <> evidence_count)
       OR (operation_state <> 'REVALIDATION_REQUIRED' AND (consumed_count <> 0 OR evidence_count <> 0))
       OR reservation_status IS DISTINCT FROM (CASE operation_state
         WHEN 'EXPIRED' THEN 'EXPIRED'
         ELSE 'RELEASED'
       END) THEN
      RAISE EXCEPTION 'terminal or revalidation operation has incoherent authorization or reservation state: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_approval_operation_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_approval_operation_consistency(NEW.operation_id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER approval_requests_state_consistency
  AFTER INSERT OR UPDATE ON approval_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_operation_consistency();

CREATE CONSTRAINT TRIGGER authorization_evidence_state_consistency
  AFTER INSERT ON authorization_evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_operation_consistency();

CREATE CONSTRAINT TRIGGER operations_approval_state_consistency
  AFTER INSERT OR UPDATE ON operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_operation_consistency();

CREATE CONSTRAINT TRIGGER reservations_approval_state_consistency
  AFTER INSERT OR UPDATE ON budget_reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_operation_consistency();
