-- Product photographs, stored in the database rather than on disk.
--
-- Render's filesystem is ephemeral: anything written to it is wiped on every
-- deploy and restart. A vendor's product photo survived until the next deploy
-- and then 404'd, with the product still pointing at the vanished file. The
-- database is the only durable store this deployment already has.
CREATE TABLE "media_object" (
  "id"           TEXT PRIMARY KEY,
  "content_type" TEXT NOT NULL,
  "bytes"        BYTEA NOT NULL,
  "size"         INTEGER NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
