ALTER TABLE `posts` ADD `resource_kind` text DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `resource_title` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `resource_url` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `resource_asset_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `resource_error` text;