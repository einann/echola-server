-- CreateIndex
CREATE INDEX "conversation_participants_user_id_left_at_is_muted_idx" ON "conversation_participants"("user_id", "left_at", "is_muted");

-- CreateIndex
CREATE INDEX "conversation_participants_left_at_idx" ON "conversation_participants"("left_at");

-- CreateIndex
CREATE INDEX "conversations_type_updated_at_idx" ON "conversations"("type", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_updated_at_idx" ON "conversations"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_name_idx" ON "conversations"("name");
