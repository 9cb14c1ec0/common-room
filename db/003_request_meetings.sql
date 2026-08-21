ALTER TABLE meeting_requests
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS meeting_requests_meeting_idx ON meeting_requests(meeting_id);
