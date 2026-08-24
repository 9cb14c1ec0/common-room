ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'Common Room meeting';
