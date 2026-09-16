CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`news_item_id` integer,
	`brief` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'drafting' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`slug` text DEFAULT '' NOT NULL,
	`meta_title` text DEFAULT '' NOT NULL,
	`meta_description` text DEFAULT '' NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '{}' NOT NULL,
	`body_html` text DEFAULT '' NOT NULL,
	`json_ld` text DEFAULT '' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`cover_asset_id` text,
	`framer_item_id` text,
	`published_url` text,
	`scheduled_at` text,
	`published_at` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`news_item_id`) REFERENCES `news_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `articles_status_idx` ON `articles` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `articles_slug_idx` ON `articles` (`slug`);