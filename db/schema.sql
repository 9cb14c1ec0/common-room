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
  is_admin boolean NOT NULL DEFAULT false,
  presence presence_status NOT NULL DEFAULT 'offline',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text,
  status meeting_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Common Room meeting',
  is_private boolean NOT NULL DEFAULT false,
  office_owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
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
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz,
  left_at timestamptz,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  description text NOT NULL,
  source_timestamp_seconds integer,
  confidence numeric(4,3),
  status action_item_status NOT NULL DEFAULT 'proposed',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  title text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meeting_requests_recipient_idx ON meeting_requests(recipient_id, status, created_at DESC);
CREATE INDEX meetings_created_idx ON meetings(created_at DESC);
CREATE INDEX action_items_assignee_idx ON action_items(assignee_id, status);
CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at);
CREATE INDEX invitations_email_idx ON invitations(email, expires_at DESC);
