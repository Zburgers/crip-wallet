CREATE OR REPLACE FUNCTION protect_operation_budget_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id
     OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'immutable operation budget binding: %', NEW.operation_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operations_budget_binding_is_immutable
  BEFORE UPDATE ON operations
  FOR EACH ROW EXECUTE FUNCTION protect_operation_budget_binding();

CREATE OR REPLACE FUNCTION protect_budget_account_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id
     OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.asset_address IS DISTINCT FROM OLD.asset_address THEN
    RAISE EXCEPTION 'immutable budget binding: %', NEW.budget_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_account_binding_is_immutable
  BEFORE UPDATE ON budget_accounts
  FOR EACH ROW EXECUTE FUNCTION protect_budget_account_binding();
