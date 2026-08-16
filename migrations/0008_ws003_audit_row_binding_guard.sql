CREATE OR REPLACE FUNCTION canonicalize_audit_json(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN
      '{' || COALESCE((
        SELECT string_agg(
          to_json(key)::text || ':' || canonicalize_audit_json(item),
          ',' ORDER BY key
        )
        FROM jsonb_each(value) AS object_entries(key, item)
      ), '') || '}'
    WHEN 'array' THEN
      '[' || COALESCE((
        SELECT string_agg(canonicalize_audit_json(item), ',' ORDER BY ordinal)
        FROM jsonb_array_elements(value) WITH ORDINALITY AS array_entries(item, ordinal)
      ), '') || ']'
    ELSE value::text
  END;
$$;

CREATE OR REPLACE FUNCTION verify_audit_event_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_payload text;
BEGIN
  expected_payload := canonicalize_audit_json(jsonb_build_object(
    'eventId', NEW.event_id,
    'eventType', NEW.event_type,
    'occurredAt', to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sequence', NEW.sequence_no,
    'actorType', NEW.actor_type,
    'actorId', NEW.actor_id,
    'ownerId', NEW.owner_id,
    'agentId', NEW.agent_id,
    'walletId', NEW.wallet_id,
    'intentId', NEW.intent_id,
    'operationId', NEW.operation_id,
    'policyId', NEW.policy_id,
    'policyVersion', NEW.policy_version,
    'traceId', NEW.trace_id,
    'data', NEW.data,
    'previousEventHash', NEW.previous_event_hash
  ));
  IF NEW.canonical_payload IS DISTINCT FROM expected_payload THEN
    RAISE EXCEPTION 'canonical audit payload does not match row: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.event_hash <> '0x' || encode(
    digest(
      convert_to('crip/audit-event/v1', 'UTF8') || decode('00', 'hex') ||
      convert_to(expected_payload, 'UTF8'),
      'sha256'
    ),
    'hex'
  ) THEN
    RAISE EXCEPTION 'audit event hash does not match canonical row: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
