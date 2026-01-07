-- AlterTable
ALTER TABLE "conversation_participants" ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinned_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_is_archived_idx" ON "conversation_participants"("user_id", "is_archived");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_is_pinned_pinned_at_idx" ON "conversation_participants"("user_id", "is_pinned", "pinned_at");
