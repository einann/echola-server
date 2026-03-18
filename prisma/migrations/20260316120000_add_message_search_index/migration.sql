-- CreateIndex for full-text search on message content
CREATE INDEX IF NOT EXISTS "message_content_search_idx" ON "messages" USING GIN (to_tsvector('english', COALESCE(content, '')));

-- Add forwarding fields to messages table
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "forwarded_from_message_id" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "forwarded_from_user_id" TEXT;

-- Add waveform_data field to message_attachments
ALTER TABLE "message_attachments" ADD COLUMN IF NOT EXISTS "waveform_data" DOUBLE PRECISION[] DEFAULT '{}';

-- Add foreign key constraints for forwarding
ALTER TABLE "messages" ADD CONSTRAINT "messages_forwarded_from_message_id_fkey"
  FOREIGN KEY ("forwarded_from_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_forwarded_from_user_id_fkey"
  FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex for forwarded messages
CREATE INDEX IF NOT EXISTS "messages_forwarded_from_message_id_idx" ON "messages"("forwarded_from_message_id");
