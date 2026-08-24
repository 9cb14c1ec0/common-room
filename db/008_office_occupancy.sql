ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS office_owner_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE meetings m
SET office_owner_id = r.sender_id
FROM meeting_requests r
WHERE r.meeting_id = m.id AND m.is_private = true AND m.office_owner_id IS NULL;
