CREATE INDEX `agent_patches_provider_call_idx` ON `agent_patches` (`provider`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `events_provider_event_idx` ON `events` (`provider`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `usage_records_key_idx` ON `usage_records` (`usage_key`);