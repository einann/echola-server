-- Drop the broken presigned-URL column and replace with a stable S3 key column.
-- Existing avatar_url values were 7-day presigned URLs, which expire and break.
-- avatar_key now stores the S3 object key; a fresh signed URL is generated on read.

ALTER TABLE "users" DROP COLUMN "avatar_url";
ALTER TABLE "users" ADD COLUMN "avatar_key" TEXT;
