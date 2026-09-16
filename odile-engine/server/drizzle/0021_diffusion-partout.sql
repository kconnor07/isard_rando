ALTER TABLE `posts` ADD `broadcast_group` text;--> statement-breakpoint
CREATE INDEX `posts_broadcast_idx` ON `posts` (`broadcast_group`);