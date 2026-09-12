ALTER TABLE `custom_themes` ADD `body_font` text DEFAULT 'inter' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `body_scale` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `body_weight` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `body_opacity` integer DEFAULT 88 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `body_color` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `line_height` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `title_tracking` integer DEFAULT -25 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `title_color` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `block_gap` integer DEFAULT 36 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `subtitle_scale` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `subtitle_tone` text DEFAULT 'voile' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `vertical_align` text DEFAULT 'centre' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `pad_top` integer;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `pad_side` integer;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `pad_bottom` integer;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `badge_style` text DEFAULT 'point' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `badge_color` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bullet_glyph` text DEFAULT 'fleche' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bullet_color` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `icon_badge_size` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `annotation_font` text DEFAULT 'caveat' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `annotation_scale` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `annotation_color` text;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `annotation_tilt` integer DEFAULT -4 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `cta_size` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `logo_size` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `footer_inset` integer DEFAULT 96 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `footer_bottom` integer DEFAULT 56 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `counter_size` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `decor_scale` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `bg_top_spread` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_themes` ADD `hero_scrim` integer DEFAULT 100 NOT NULL;