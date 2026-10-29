CREATE TABLE `batches` (
	`batch_index` integer PRIMARY KEY NOT NULL,
	`first_seq` integer NOT NULL,
	`last_seq` integer NOT NULL,
	`root` text NOT NULL,
	`size` integer NOT NULL,
	`ts` integer NOT NULL,
	`tree_dump` text NOT NULL,
	`signature` text NOT NULL,
	`anchor_tx` text,
	`anchor_block` integer,
	`anchor_ts` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_root_unique` ON `batches` (`root`);--> statement-breakpoint
CREATE TABLE `blobs` (
	`body_hash` text PRIMARY KEY NOT NULL,
	`content` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`seq` integer PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`request_id` text NOT NULL,
	`mandate_id` text,
	`agent_id` text,
	`payload_commitment` text NOT NULL,
	`prev_hash` text NOT NULL,
	`entry_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entries_request` ON `entries` (`request_id`);--> statement-breakpoint
CREATE TABLE `fields` (
	`seq` integer NOT NULL,
	`name` text NOT NULL,
	`value_json` text NOT NULL,
	`salt` text NOT NULL,
	PRIMARY KEY(`seq`, `name`),
	FOREIGN KEY (`seq`) REFERENCES `entries`(`seq`) ON UPDATE no action ON DELETE no action
);
