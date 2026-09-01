ALTER TABLE `news_items` ADD `content_text` text;--> statement-breakpoint
ALTER TABLE `news_items` ADD `extracted_at` text;--> statement-breakpoint
ALTER TABLE `news_items` ADD `engagement` integer;--> statement-breakpoint
ALTER TABLE `news_items` ADD `engagement_raw` text;--> statement-breakpoint
ALTER TABLE `news_items` ADD `topics` text;--> statement-breakpoint
ALTER TABLE `news_items` ADD `score_final` real;--> statement-breakpoint
ALTER TABLE `news_sources` ADD `consecutive_errors` integer DEFAULT 0 NOT NULL;