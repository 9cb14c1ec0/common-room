ALTER TABLE meeting_requests DROP CONSTRAINT IF EXISTS meeting_requests_sender_id_fkey;
ALTER TABLE meeting_requests ADD CONSTRAINT meeting_requests_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE meeting_requests DROP CONSTRAINT IF EXISTS meeting_requests_recipient_id_fkey;
ALTER TABLE meeting_requests ADD CONSTRAINT meeting_requests_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE meeting_participants DROP CONSTRAINT IF EXISTS meeting_participants_user_id_fkey;
ALTER TABLE meeting_participants ADD CONSTRAINT meeting_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE action_items DROP CONSTRAINT IF EXISTS action_items_assignee_id_fkey;
ALTER TABLE action_items ADD CONSTRAINT action_items_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_created_by_fkey;
ALTER TABLE invitations ADD CONSTRAINT invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
