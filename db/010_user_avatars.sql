ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_content_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
