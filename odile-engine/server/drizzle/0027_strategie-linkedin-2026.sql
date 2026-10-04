CREATE TABLE `faits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`texte` text NOT NULL,
	`date_fait` text,
	`source` text DEFAULT 'autre' NOT NULL,
	`compte` text,
	`accord_client` integer DEFAULT false NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`utilisations` integer DEFAULT 0 NOT NULL,
	`dernier_usage` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `fait_id` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `texte_genere` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `promo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `reposts` text;
