CREATE SCHEMA IF NOT EXISTS licensegraph;
CREATE DOMAIN licensegraph.cents AS bigint CHECK (VALUE >= 0 AND VALUE <= 9007199254740991);
CREATE TABLE licensegraph.users (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  roles text[] NOT NULL DEFAULT '{buyer}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  CHECK (roles <@ ARRAY['buyer','licensor','staff']::text[])
);
CREATE TABLE licensegraph.auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES licensegraph.users,
  expires_at timestamptz NOT NULL,
  mfa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE licensegraph.login_attempts (
  state_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE TABLE licensegraph.runs (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES licensegraph.users,
  legacy_owner_hash text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  phase text NOT NULL,
  sealed text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  quarantine_reason text
);
CREATE INDEX runs_owner_created ON licensegraph.runs(owner_id, created_at DESC);
CREATE TABLE licensegraph.documents (
  run_id uuid NOT NULL REFERENCES licensegraph.runs,
  document_id text NOT NULL,
  content_hash text NOT NULL,
  sealed text NOT NULL,
  PRIMARY KEY (run_id, document_id)
);
CREATE TABLE licensegraph.ledger_events (
  run_id uuid NOT NULL REFERENCES licensegraph.runs,
  seq integer NOT NULL CHECK (seq > 0),
  hash text NOT NULL,
  sealed text NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE FUNCTION licensegraph.immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable record'; END $$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON licensegraph.ledger_events FOR EACH ROW EXECUTE FUNCTION licensegraph.immutable_row();
CREATE TRIGGER immutable_documents BEFORE UPDATE OR DELETE ON licensegraph.documents FOR EACH ROW EXECUTE FUNCTION licensegraph.immutable_row();
CREATE TABLE licensegraph.operations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES licensegraph.runs,
  kind text NOT NULL CHECK (kind IN ('pipeline','order','capture','payout','refund','refresh','webhook')),
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','reconcile','canceled')),
  stage text NOT NULL DEFAULT 'waiting' CHECK (stage IN ('waiting','prepared','submitted','recorded')),
  lease_token uuid,
  lease_until timestamptz,
  external_key text,
  sealed text,
  error_code text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, kind, dedupe_key)
);
CREATE INDEX operations_queue ON licensegraph.operations(available_at, created_at) WHERE status = 'queued';
CREATE UNIQUE INDEX operations_running_run ON licensegraph.operations(run_id) WHERE status = 'running';
CREATE TABLE licensegraph.webhook_deliveries (
  event_id text PRIMARY KEY,
  sealed text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processed','reconcile')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE licensegraph.licensors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES licensegraph.users,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  sealed text NOT NULL,
  recipient_confirmed_at timestamptz,
  reviewed_by uuid REFERENCES licensegraph.users,
  reviewed_at timestamptz,
  review_reason text,
  CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND recipient_confirmed_at IS NOT NULL))
);
CREATE TABLE licensegraph.offers (
  id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  licensor_id uuid NOT NULL REFERENCES licensegraph.licensors,
  licensor_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  amount_cents licensegraph.cents NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency NOT IN ('JPY','HUF','TWD')),
  sealed text NOT NULL,
  reviewed_by uuid REFERENCES licensegraph.users,
  reviewed_at timestamptz,
  PRIMARY KEY (id, version),
  CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE licensegraph.purchase_authorizations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES licensegraph.runs,
  approved_by uuid NOT NULL REFERENCES licensegraph.users,
  version integer NOT NULL DEFAULT 3 CHECK (version = 3),
  digest text NOT NULL,
  amount_cents licensegraph.cents NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sealed text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_authorizations BEFORE UPDATE OR DELETE ON licensegraph.purchase_authorizations FOR EACH ROW EXECUTE FUNCTION licensegraph.immutable_row();
CREATE TABLE licensegraph.purchases (
  run_id uuid PRIMARY KEY REFERENCES licensegraph.runs,
  authorization_id uuid NOT NULL REFERENCES licensegraph.purchase_authorizations,
  order_id text UNIQUE,
  capture_id text UNIQUE,
  captured_at timestamptz,
  release_at timestamptz,
  accepted_at timestamptz,
  payout_state text NOT NULL DEFAULT 'held' CHECK (payout_state IN ('held','submitting','submitted','settled','reconcile','refunded')),
  sealed text NOT NULL
);
CREATE TABLE licensegraph.disputes (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES licensegraph.runs,
  opened_by uuid NOT NULL REFERENCES licensegraph.users,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','released','refunded')),
  sealed text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES licensegraph.users,
  resolved_at timestamptz
);
CREATE UNIQUE INDEX one_active_dispute ON licensegraph.disputes(run_id) WHERE status IN ('open','escalated');
CREATE TABLE licensegraph.share_grants (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES licensegraph.runs,
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('receipt','passport')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE licensegraph.audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid REFERENCES licensegraph.users,
  action text NOT NULL,
  resource_id text NOT NULL,
  sealed text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON licensegraph.audit_events FOR EACH ROW EXECUTE FUNCTION licensegraph.immutable_row();
CREATE TABLE licensegraph.rate_slots (
  key text PRIMARY KEY,
  next_at timestamptz NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);
CREATE TABLE licensegraph.import_records (
  source_hash text PRIMARY KEY,
  run_id uuid,
  status text NOT NULL CHECK (status IN ('imported','quarantined')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
