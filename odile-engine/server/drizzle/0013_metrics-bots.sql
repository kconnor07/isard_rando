CREATE TABLE `post_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`fetched_at` text NOT NULL,
	`reach` integer,
	`impressions` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`saves` integer,
	`engagement` integer,
	`partial` text,
	`raw` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_metrics_post_idx` ON `post_metrics` (`post_id`,`fetched_at`);--> statement-breakpoint
ALTER TABLE `clicks` ADD `bot` integer DEFAULT false NOT NULL;