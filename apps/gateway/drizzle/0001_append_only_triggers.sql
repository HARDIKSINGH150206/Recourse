-- The evidence log is append-only. UPDATE and DELETE on log tables are rejected by the database
-- itself, so even a bug (or a compromised route) cannot silently rewrite history.
-- The dev-only tamper route (ENABLE_DEV_ROUTES=1) drops and recreates these on purpose.
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries
BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries
BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER fields_no_update BEFORE UPDATE ON fields
BEGIN SELECT RAISE(ABORT, 'fields are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER fields_no_delete BEFORE DELETE ON fields
BEGIN SELECT RAISE(ABORT, 'fields are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER blobs_no_update BEFORE UPDATE ON blobs
BEGIN SELECT RAISE(ABORT, 'blobs are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER blobs_no_delete BEFORE DELETE ON blobs
BEGIN SELECT RAISE(ABORT, 'blobs are append-only'); END;
--> statement-breakpoint
-- A batch's content is immutable; only the anchor columns may be filled in, once.
CREATE TRIGGER batches_no_delete BEFORE DELETE ON batches
BEGIN SELECT RAISE(ABORT, 'batches are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER batches_immutable_core BEFORE UPDATE ON batches
WHEN NEW.batch_index IS NOT OLD.batch_index OR NEW.first_seq IS NOT OLD.first_seq
  OR NEW.last_seq IS NOT OLD.last_seq OR NEW.root IS NOT OLD.root OR NEW.size IS NOT OLD.size
  OR NEW.ts IS NOT OLD.ts OR NEW.tree_dump IS NOT OLD.tree_dump OR NEW.signature IS NOT OLD.signature
  OR (OLD.anchor_tx IS NOT NULL AND NEW.anchor_tx IS NOT OLD.anchor_tx)
BEGIN SELECT RAISE(ABORT, 'batch content is immutable'); END;
