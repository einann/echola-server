/*
  Warnings:

  - You are about to drop the column `content_type` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `file_name` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `file_size` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `media_url` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `thumbnail_url` on the `messages` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'MEDIA', 'SYSTEM', 'DELETED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT');

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "content_type",
DROP COLUMN "file_name",
DROP COLUMN "file_size",
DROP COLUMN "media_url",
DROP COLUMN "thumbnail_url",
ADD COLUMN     "type" "MessageType" NOT NULL DEFAULT 'TEXT';

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "media_type" "MediaType" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "thumbnail_url" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "is_processed" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE INDEX "message_attachments_file_key_idx" ON "message_attachments"("file_key");

-- CreateIndex
CREATE INDEX "message_attachments_bucket_created_at_idx" ON "message_attachments"("bucket", "created_at");

-- CreateIndex
CREATE INDEX "messages_type_idx" ON "messages"("type");

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
