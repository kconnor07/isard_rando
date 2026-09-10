CREATE TABLE `custom_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`accent` text DEFAULT '#0099ff' NOT NULL,
	`bg1` text DEFAULT '#050508' NOT NULL,
	`bg2` text DEFAULT '#0a1024' NOT NULL,
	`text_color` text DEFAULT '#fdfdfd' NOT NULL,
	`decor` text DEFAULT 'orbes' NOT NULL,
	`background_asset_id` text,
	`background_opacity` integer DEFAULT 35 NOT NULL,
	`grain` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
