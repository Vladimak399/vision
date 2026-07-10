-- TASK-36: Template export snapshots
-- Stores snapshots of exported Excel files with metadata about which prices were used

CREATE TABLE IF NOT EXISTS template_export_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week IN (1, 2)),

  -- Original file info
  original_filename TEXT NOT NULL,
  original_file_size INTEGER NOT NULL,

  -- Snapshot metadata
  snapshot_created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  snapshot_id TEXT NOT NULL UNIQUE, -- Human-readable ID like "export-20260709-001"

  -- Price data used in this export
  -- Map of catalog_product_id -> store_id -> price_minor
  price_data JSONB NOT NULL,

  -- Coverage info
  total_price_cells INTEGER NOT NULL,
  filled_price_cells INTEGER NOT NULL,
  coverage_pct NUMERIC(5, 2) NOT NULL,

  -- Store mapping info
  total_stores INTEGER NOT NULL,
  resolved_stores INTEGER NOT NULL,
  unresolved_stores INTEGER NOT NULL,

  -- Warnings
  warnings TEXT[] DEFAULT '{}',

  -- User who triggered export (optional, for audit trail)
  triggered_by UUID REFERENCES auth.users(id),

  -- Indexes for fast lookup
  INDEX idx_snapshots_company_week (company_id, week),
  INDEX idx_snapshots_snapshot_id (snapshot_id),
  INDEX idx_snapshots_created_at (snapshot_created_at DESC)
);

-- RLS
ALTER TABLE template_export_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company's snapshots"
  ON template_export_snapshots
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE id IN (
        SELECT company_id FROM company_memberships
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create snapshots for their company"
  ON template_export_snapshots
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE id IN (
        SELECT company_id FROM company_memberships
        WHERE user_id = auth.uid()
      )
    )
  );

-- Comment
COMMENT ON TABLE template_export_snapshots IS 'Snapshot of template export with price data for audit trail (TASK-36)';
