-- =============================================================================
-- Contracts: optional drawn signature (Phase 16, Polish)
-- =============================================================================
-- Adds a column to store an optional drawn signature image, captured
-- client-side as a PNG data URL from a <canvas>. Typed-name remains the
-- primary, legally-sufficient signature record (see 20260424030000) —
-- the drawn signature is supplementary evidence and a UX upgrade for
-- clients who expect to "sign" something visual.
--
-- Why text (vs bytea / Supabase Storage)?
--   - Pictures of a finger swipe on a phone are tiny (<30 KB typical).
--   - Storing inline keeps the signature with the contract row, no
--     second fetch needed when rendering the admin signature panel.
--   - Switching to Storage later is straightforward: drop a file id
--     column next to this and migrate existing rows lazily.
-- =============================================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS signer_signature_data_url text;

COMMENT ON COLUMN public.contracts.signer_signature_data_url IS
  'Optional drawn-signature PNG as a data URL (data:image/png;base64,...). Captured from a <canvas> on the public sign page. Typed-name remains the primary signature record per ESIGN / UETA — this is supplementary.';

-- Soft cap on payload size at the DB level so a malicious / buggy
-- client can''t balloon the column. ~200 KB is comfortably more than a
-- typical mobile signature trace and 6.5x our observed average.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_signature_size_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_signature_size_check
      CHECK (
        signer_signature_data_url IS NULL
        OR length(signer_signature_data_url) <= 300000
      );
  END IF;
END $$;
