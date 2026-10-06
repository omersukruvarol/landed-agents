ALTER TABLE `outcomes` ADD `unknown_reason` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `outcome_control_a` real;--> statement-breakpoint
ALTER TABLE `repos` ADD `outcome_control_b` real;--> statement-breakpoint
ALTER TABLE `repos` ADD `outcome_confidence` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `outcomes_computed_at` integer;