ALTER TABLE `custom_themes` ADD `title_gradient` text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `cta_style` text DEFAULT 'verre' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `show_author` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `float_asset_id_1` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `float_asset_id_2` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `float_size` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `float_layout` text DEFAULT 'coins' NOT NULL;