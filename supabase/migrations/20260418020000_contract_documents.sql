-- Private storage bucket for contract documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-docs',
  'contract-docs',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png', 'image/jpeg', 'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: org members can read
CREATE POLICY "contract_docs_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contract-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
  );

-- Storage RLS: owners/admins/managers can upload
CREATE POLICY "contract_docs_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contract-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- Storage RLS: owners/admins/managers can delete
CREATE POLICY "contract_docs_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contract-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- Metadata table
CREATE TABLE IF NOT EXISTS public.contract_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id     uuid        NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  storage_path    text        NOT NULL,
  file_size       bigint,
  mime_type       text,
  uploaded_by     uuid        REFERENCES public.memberships(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_docs_contract_idx ON public.contract_documents(contract_id);

ALTER TABLE public.contract_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_contract_docs"
  ON public.contract_documents FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "org_managers_manage_contract_docs"
  ON public.contract_documents FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  ));
