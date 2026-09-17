ALTER TABLE `posts` ADD `video_script` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `video_provider_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `video_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `video_asset_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `video_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `video_error` text;