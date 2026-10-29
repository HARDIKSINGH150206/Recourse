CREATE TABLE `bench_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`results_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`dispute_id` text PRIMARY KEY NOT NULL,
	`escrow_id` text NOT NULL,
	`mandate_id` text NOT NULL,
	`request_id` text NOT NULL,
	`reason_text` text,
	`reason_hash` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`evidence_report_json` text,
	`opened_tx` text,
	`resolved_tx` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `disputes_escrow_id_unique` ON `disputes` (`escrow_id`);--> statement-breakpoint
CREATE INDEX `disputes_status` ON `disputes` (`status`);--> statement-breakpoint
CREATE INDEX `disputes_mandate` ON `disputes` (`mandate_id`);--> statement-breakpoint
CREATE TABLE `mandates` (
	`mandate_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`agent` text NOT NULL,
	`mandate_json` text NOT NULL,
	`terms_json` text NOT NULL,
	`terms_hash` text NOT NULL,
	`merchants_json` text NOT NULL,
	`signature` text NOT NULL,
	`summary` text NOT NULL,
	`registered_onchain` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mandates_owner` ON `mandates` (`owner`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`dispute_id` text PRIMARY KEY NOT NULL,
	`outcome` text NOT NULL,
	`fault` text NOT NULL,
	`note` text NOT NULL,
	`commitment` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`dispute_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verdicts` (
	`dispute_id` text PRIMARY KEY NOT NULL,
	`verdict_json` text NOT NULL,
	`commitment` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`dispute_id`) ON UPDATE no action ON DELETE no action
);
