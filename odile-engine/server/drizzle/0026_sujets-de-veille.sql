CREATE TABLE `news_subjects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`reason` text,
	`angles` text DEFAULT '[]' NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`item_ids` text DEFAULT '[]' NOT NULL,
	`sources_count` integer DEFAULT 0 NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'actu' NOT NULL,
	`status` text DEFAULT 'nouveau' NOT NULL,
	`post_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `news_subjects_status_idx` ON `news_subjects` (`status`,`score`);
