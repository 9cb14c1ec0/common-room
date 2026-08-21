CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE presence_status AS ENUM ('available', 'busy', 'do_not_disturb', 'offline');
CREATE TYPE meeting_request_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled', 'expired');
CREATE TYPE meeting_status AS ENUM ('waiting', 'active', 'processing', 'complete', 'failed');
CREATE TYPE action_item_status AS ENUM ('proposed', 'accepted', 'complete', 'dismissed');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  title text NOT NULL DEFAULT '',
  presence presence_status NOT NULL DEFAULT 'offline',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  message text,
  status meeting_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signalwire_room_name text NOT NULL UNIQUE,
  status meeting_status NOT NULL DEFAULT 'waiting',
  started_at timestamptz,
  ended_at timestamptz,
  recording_url text,
  transcript jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting_participants (
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz,
  left_at timestamptz,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES users(id),
  description text NOT NULL,
  source_timestamp_seconds integer,
  confidence numeric(4,3),
  status action_item_status NOT NULL DEFAULT 'proposed',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meeting_requests_recipient_idx ON meeting_requests(recipient_id, status, created_at DESC);
CREATE INDEX meetings_created_idx ON meetings(created_at DESC);
CREATE INDEX action_items_assignee_idx ON action_items(assignee_id, status);
