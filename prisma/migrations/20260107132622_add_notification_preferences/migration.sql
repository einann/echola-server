-- AlterTable
ALTER TABLE "conversation_participants" ADD COLUMN     "notify_on_mention" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_on_message" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_sound" BOOLEAN NOT NULL DEFAULT true;
