ALTER TABLE `custom_themes` ADD `brand_style` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `counter_style` text DEFAULT 'pilule' NOT NULL;--> statement-breakpoint
UPDATE `custom_themes` SET `brand_style` = 'aucun' WHERE `show_logo` = 0;