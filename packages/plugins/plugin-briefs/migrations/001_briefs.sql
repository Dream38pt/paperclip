CREATE TABLE plugin_briefs_eacdc5f4df.briefs_cards (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  grouping_description text NOT NULL,
  grouping_hash text NOT NULL,
  root_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('error', 'blocked', 'waiting-user', 'waiting-reviewer', 'live', 'done', 'stale')),
  summary_status text NOT NULL CHECK (summary_status IN ('ok', 'pending', 'fallback')),
  pinned boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  stale_at timestamptz NOT NULL,
  expires_at timestamptz,
  latest_snapshot_id uuid,
  last_meaningful_event_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, grouping_hash),
  UNIQUE (company_id, user_id, slug)
);

CREATE TABLE plugin_briefs_eacdc5f4df.briefs_card_sources (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES plugin_briefs_eacdc5f4df.briefs_cards(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('issue_tree', 'issue', 'run', 'comment', 'document', 'work_product', 'interaction', 'activity_event', 'approval')),
  source_id text NOT NULL,
  source_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  source_run_id uuid REFERENCES public.heartbeat_runs(id) ON DELETE SET NULL,
  identifier text,
  title_line text NOT NULL,
  right_tag text NOT NULL,
  link_path text NOT NULL,
  is_intra_tree_blocked boolean,
  event_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, source_kind, source_id)
);

CREATE TABLE plugin_briefs_eacdc5f4df.briefs_card_snapshots (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES plugin_briefs_eacdc5f4df.briefs_cards(id) ON DELETE CASCADE,
  summary_paragraph text,
  summary_status text NOT NULL CHECK (summary_status IN ('ok', 'pending', 'fallback')),
  summary_model text,
  summary_tokens_in integer,
  summary_tokens_out integer,
  summary_failure_reason text CHECK (summary_failure_reason IS NULL OR summary_failure_reason IN ('model_error', 'truncation_failed', 'budget_capped', 'safety_block')),
  task_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  generated_by_run_id uuid REFERENCES public.heartbeat_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plugin_briefs_eacdc5f4df.briefs_cards
  ADD CONSTRAINT briefs_cards_latest_snapshot_fk
  FOREIGN KEY (latest_snapshot_id)
  REFERENCES plugin_briefs_eacdc5f4df.briefs_card_snapshots(id)
  ON DELETE SET NULL;

CREATE TABLE plugin_briefs_eacdc5f4df.briefs_user_preferences (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  cadence text NOT NULL DEFAULT 'hourly',
  discovery_window_days integer NOT NULL DEFAULT 14 CHECK (discovery_window_days > 0),
  retention_days integer NOT NULL DEFAULT 7 CHECK (retention_days > 0),
  done_retention_hours integer NOT NULL DEFAULT 72 CHECK (done_retention_hours > 0),
  stale_after_days integer NOT NULL DEFAULT 7 CHECK (stale_after_days > 0),
  max_unpinned_cards integer NOT NULL DEFAULT 50 CHECK (max_unpinned_cards > 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE TABLE plugin_briefs_eacdc5f4df.briefs_cursors (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  cursor_key text NOT NULL,
  last_event_at timestamptz,
  last_event_id text,
  overlap_window_seconds integer NOT NULL DEFAULT 3600 CHECK (overlap_window_seconds >= 0),
  dedupe_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, cursor_key)
);

CREATE INDEX briefs_cards_company_user_state_idx ON plugin_briefs_eacdc5f4df.briefs_cards (company_id, user_id, hidden, state, pinned, last_meaningful_event_at DESC);
CREATE INDEX briefs_cards_company_root_idx ON plugin_briefs_eacdc5f4df.briefs_cards (company_id, root_issue_id);
CREATE INDEX briefs_cards_expiry_idx ON plugin_briefs_eacdc5f4df.briefs_cards (company_id, expires_at) WHERE expires_at IS NOT NULL AND pinned = false;
CREATE INDEX briefs_card_sources_card_event_idx ON plugin_briefs_eacdc5f4df.briefs_card_sources (card_id, event_at DESC);
CREATE INDEX briefs_card_sources_company_source_idx ON plugin_briefs_eacdc5f4df.briefs_card_sources (company_id, source_kind, source_id);
CREATE INDEX briefs_snapshots_card_created_idx ON plugin_briefs_eacdc5f4df.briefs_card_snapshots (card_id, created_at DESC);
CREATE INDEX briefs_cursors_company_user_idx ON plugin_briefs_eacdc5f4df.briefs_cursors (company_id, user_id, updated_at DESC);
