CREATE TABLE licensegraph.agent_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES licensegraph.users,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE licensegraph.purchase_recipients (
  run_id uuid NOT NULL REFERENCES licensegraph.purchases,
  licensor_id uuid NOT NULL REFERENCES licensegraph.licensors,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  amount_cents licensegraph.cents NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  PRIMARY KEY (run_id,offer_id,offer_version),
  FOREIGN KEY (offer_id,offer_version) REFERENCES licensegraph.offers(id,version)
);
CREATE INDEX purchase_recipients_licensor ON licensegraph.purchase_recipients(licensor_id,run_id);
ALTER TABLE licensegraph.purchases ADD COLUMN payout_batch_id text UNIQUE;
CREATE FUNCTION licensegraph.immutable_offer_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.version<>OLD.version OR NEW.licensor_id<>OLD.licensor_id OR NEW.licensor_version<>OLD.licensor_version OR NEW.amount_cents<>OLD.amount_cents OR NEW.currency<>OLD.currency OR NEW.sealed<>OLD.sealed THEN
    RAISE EXCEPTION 'offer content is immutable; create a new version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_offer_content BEFORE UPDATE ON licensegraph.offers FOR EACH ROW EXECUTE FUNCTION licensegraph.immutable_offer_content();
