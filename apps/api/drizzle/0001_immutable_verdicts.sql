-- Verdicts and reviews are the replayable record of a decision: never rewritten or deleted.
CREATE TRIGGER verdicts_no_update BEFORE UPDATE ON verdicts
BEGIN SELECT RAISE(ABORT, 'verdicts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER verdicts_no_delete BEFORE DELETE ON verdicts
BEGIN SELECT RAISE(ABORT, 'verdicts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON reviews
BEGIN SELECT RAISE(ABORT, 'reviews are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON reviews
BEGIN SELECT RAISE(ABORT, 'reviews are immutable'); END;
