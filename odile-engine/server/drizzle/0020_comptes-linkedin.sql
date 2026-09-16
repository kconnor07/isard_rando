DROP INDEX `oauth_subject_idx`;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `account_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `oauth_tokens` SET `account_key` = `external_id` WHERE `provider` = 'linkedin' AND `external_id` <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_subject_idx` ON `oauth_tokens` (`provider`,`subject`,`account_key`);--> statement-breakpoint
ALTER TABLE `posts` ADD `li_account_key` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `mentions` text;