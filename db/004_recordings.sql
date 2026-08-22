ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS agora_channel_name text,
  ADD COLUMN IF NOT EXISTS recording_resource_id text,
  ADD COLUMN IF NOT EXISTS recording_sid text,
  ADD COLUMN IF NOT EXISTS recording_uid text,
  ADD COLUMN IF NOT EXISTS recording_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS recording_files jsonb,
  ADD COLUMN IF NOT EXISTS transcription_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_error text;
