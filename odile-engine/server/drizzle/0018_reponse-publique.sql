ALTER TABLE `comments` ADD `public_reply_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `public_reply_error` text;