CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`jti` text NOT NULL,
	`kind` text DEFAULT 'approval' NOT NULL,
	`sent_to` text NOT NULL,
	`email_message_id` text,
	`sent_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`reminders_sent` integer DEFAULT 0 NOT NULL,
	`action` text,
	`acted_at` text,
	`acted_ip` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_jti_idx` ON `approvals` (`jti`);--> statement-breakpoint
CREATE INDEX `approvals_post_idx` ON `approvals` (`post_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`post_id` integer,
	`slide_id` integer,
	`path` text NOT NULL,
	`width` integer,
	`height` integer,
	`mime` text DEFAULT 'image/png' NOT NULL,
	`bytes` integer,
	`sha256` text,
	`meta` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`link_id` integer NOT NULL,
	`ts` text NOT NULL,
	`ip_hash` text NOT NULL,
	`ua` text,
	`referer` text,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `clicks_link_idx` ON `clicks` (`link_id`,`ts`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`post_id` integer,
	`external_post_id` text,
	`external_post_url` text,
	`author_external_id` text,
	`author_name` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`created_time` text,
	`matched_keyword` text,
	`dm_status` text DEFAULT 'none' NOT NULL,
	`suggested_reply` text,
	`raw` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_external_idx` ON `comments` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `comments_dm_idx` ON `comments` (`dm_status`);--> statement-breakpoint
CREATE TABLE `design_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`slide_id` integer,
	`iteration` integer NOT NULL,
	`reviewer` text NOT NULL,
	`score` integer NOT NULL,
	`verdict` text DEFAULT '' NOT NULL,
	`issues` text DEFAULT '[]' NOT NULL,
	`passed` integer NOT NULL,
	`model_used` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_reviews_post_idx` ON `design_reviews` (`post_id`,`iteration`);--> statement-breakpoint
CREATE TABLE `dm_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` integer,
	`platform` text NOT NULL,
	`recipient_external_id` text,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`sent_at` text NOT NULL,
	`error` text,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`post_id` integer,
	`to` text NOT NULL,
	`message_id` text,
	`status` text NOT NULL,
	`error` text,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_name` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`ok` integer,
	`summary` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_name_idx` ON `job_runs` (`job_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`target_url` text NOT NULL,
	`post_id` integer,
	`label` text DEFAULT '' NOT NULL,
	`utm` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_code_idx` ON `links` (`code`);--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`image_url` text,
	`published_at` text,
	`fetched_at` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`content_hash` text NOT NULL,
	`score_relevance` integer,
	`score_click` integer,
	`score_total` integer,
	`score_reason` text,
	`scored_at` text,
	`shortlist_date` text,
	`shortlist_rank` integer,
	`status` text DEFAULT 'new' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_hash_idx` ON `news_items` (`content_hash`);--> statement-breakpoint
CREATE INDEX `news_items_status_idx` ON `news_items` (`status`);--> statement-breakpoint
CREATE INDEX `news_items_shortlist_idx` ON `news_items` (`shortlist_date`,`shortlist_rank`);--> statement-breakpoint
CREATE TABLE `news_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_fetched_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`scopes` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`meta` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_subject_idx` ON `oauth_tokens` (`provider`,`subject`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`news_item_id` integer,
	`platform` text NOT NULL,
	`channel` text NOT NULL,
	`format` text NOT NULL,
	`theme` text NOT NULL,
	`language` text DEFAULT 'fr' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`hook` text DEFAULT '' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`cta` text DEFAULT '' NOT NULL,
	`hashtags` text DEFAULT '[]' NOT NULL,
	`link_id` integer,
	`comment_trigger_keyword` text,
	`tone_snapshot` text,
	`review_summary` text,
	`scheduled_at` text,
	`approved_at` text,
	`published_at` text,
	`external_post_id` text,
	`external_url` text,
	`reject_reason` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`news_item_id`) REFERENCES `news_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_status_idx` ON `posts` (`status`);--> statement-breakpoint
CREATE INDEX `posts_created_idx` ON `posts` (`created_at`);--> statement-breakpoint
CREATE TABLE `publish_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`scheduled_at` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`last_error` text,
	`started_at` text,
	`finished_at` text,
	`result` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publish_jobs_state_idx` ON `publish_jobs` (`state`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`render_asset_id` text,
	`screenshot_asset_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slides_post_idx` ON `slides` (`post_id`,`idx`);