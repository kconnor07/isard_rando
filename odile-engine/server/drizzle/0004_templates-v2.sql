ALTER TABLE `custom_themes` ADD `grain_level` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `secondary` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `title_font` text DEFAULT 'inter' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `title_weight` integer DEFAULT 800 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `title_case` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `title_scale` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `accent_style` text DEFAULT 'serif' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `align` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `decor_intensity` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `decor_position` text DEFAULT 'haut-droite' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `gradient_angle` integer DEFAULT 168 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `vignette` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bg_fit` text DEFAULT 'cover' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bg_position` text DEFAULT 'centre' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bg_blur` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bg_blend` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `radius` text DEFAULT 'pill' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `glass` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `frame` text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `padding` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `show_logo` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `show_counter` integer DEFAULT true NOT NULL;