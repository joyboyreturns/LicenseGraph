ALTER TABLE licensegraph.webhook_deliveries
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
CREATE INDEX webhook_deliveries_pending ON licensegraph.webhook_deliveries(created_at) WHERE status IN ('queued','reconcile');

CREATE TABLE licensegraph.worker_heartbeats (
  worker_id text PRIMARY KEY,
  beat_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now()
);
