ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

UPDATE meetings
SET is_private = true
WHERE signalwire_room_name LIKE 'meeting-%';
