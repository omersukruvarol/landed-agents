CREATE TABLE `agent_patches` (
	`id` text PRIMARY KEY NOT NULL,
	`patch_key` text NOT NULL,
	`session_id` text NOT NULL,
	`provider` text NOT NULL,
	`tool_call_id` text,
	`timestamp` integer NOT NULL,
	`repo_id` text,
	`path` text NOT NULL,
	`rel_path` text,
	`operation` text NOT NULL,
	`added_line_count_raw` integer NOT NULL,
	`removed_line_count_raw` integer NOT NULL,
	`source_file` text NOT NULL,
	`source_offset` integer NOT NULL,
	`parser_version` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_patches_key_uq` ON `agent_patches` (`patch_key`);--> statement-breakpoint
CREATE INDEX `agent_patches_session_idx` ON `agent_patches` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_patches_repo_path_idx` ON `agent_patches` (`repo_id`,`rel_path`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collisions` (
	`id` text PRIMARY KEY NOT NULL,
	`collision_key` text NOT NULL,
	`repo_id` text NOT NULL,
	`rel_path` text NOT NULL,
	`session_a` text NOT NULL,
	`session_b` text NOT NULL,
	`kind` text NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_a`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_b`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collisions_key_uq` ON `collisions` (`collision_key`);--> statement-breakpoint
CREATE INDEX `collisions_repo_window_idx` ON `collisions` (`repo_id`,`window_start`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`schema_version` integer NOT NULL,
	`session_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text,
	`provider_event_type` text NOT NULL,
	`provider_version` text,
	`provider_session_id` text NOT NULL,
	`provider_parent_session_id` text,
	`user_id` text,
	`timestamp` integer NOT NULL,
	`received_at` integer NOT NULL,
	`sequence` integer,
	`event_type` text NOT NULL,
	`status` text,
	`cwd` text,
	`repo_root` text,
	`repo_remote_hash` text,
	`project_name` text,
	`git_branch` text,
	`git_head` text,
	`model` text,
	`tool_name` text,
	`tool_category` text,
	`tool_call_id` text,
	`command_executable` text,
	`command_display` text,
	`command_exit_code` integer,
	`file_path` text,
	`file_operation` text,
	`usage_input_tokens` integer,
	`usage_output_tokens` integer,
	`usage_cached_input_tokens` integer,
	`usage_reasoning_tokens` integer,
	`usage_estimated_cost_usd` real,
	`usage_cost_confidence` text,
	`usage_pricing_version` text,
	`error_code` text,
	`error_message` text,
	`content` text,
	`prompt_captured` integer NOT NULL,
	`arguments_captured` integer NOT NULL,
	`result_captured` integer NOT NULL,
	`redactions_applied` integer NOT NULL,
	`source_file` text,
	`source_offset` integer,
	`parser_version` text,
	`raw_payload_ref` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_fingerprint_uq` ON `events` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `events_session_ts_idx` ON `events` (`session_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `events_ts_idx` ON `events` (`timestamp`);--> statement-breakpoint
CREATE INDEX `events_type_ts_idx` ON `events` (`event_type`,`timestamp`);--> statement-breakpoint
CREATE TABLE `git_line_index` (
	`repo_id` text NOT NULL,
	`rel_path` text NOT NULL,
	`fp` text NOT NULL,
	`commit_sha` text NOT NULL,
	`commit_time` integer NOT NULL,
	`on_default_branch` integer NOT NULL,
	PRIMARY KEY(`repo_id`, `rel_path`, `fp`, `commit_sha`),
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ingestion_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`source_file` text NOT NULL,
	`offset` integer NOT NULL,
	`parser_version` text NOT NULL,
	`reason_code` text NOT NULL,
	`message` text,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingestion_failures_loc_uq` ON `ingestion_failures` (`source_file`,`offset`,`parser_version`);--> statement-breakpoint
CREATE INDEX `ingestion_failures_occurred_idx` ON `ingestion_failures` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`insight_key` text NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL,
	`session_id` text,
	`thread_id` text,
	`repo_id` text,
	`created_at` integer NOT NULL,
	`dismissed_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insights_key_uq` ON `insights` (`insight_key`);--> statement-breakpoint
CREATE INDEX `insights_session_type_idx` ON `insights` (`session_id`,`type`);--> statement-breakpoint
CREATE TABLE `open_loops` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_key` text NOT NULL,
	`type` text NOT NULL,
	`repo_id` text,
	`thread_id` text,
	`session_ids` text NOT NULL,
	`since` integer NOT NULL,
	`size_files` integer,
	`size_lines` integer,
	`size_commits` integer,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL,
	`state` text NOT NULL,
	`resolved_by` text,
	`dismiss_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `open_loops_key_uq` ON `open_loops` (`loop_key`);--> statement-breakpoint
CREATE INDEX `open_loops_state_repo_idx` ON `open_loops` (`state`,`repo_id`);--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_key` text NOT NULL,
	`scope` text NOT NULL,
	`patch_id` text,
	`session_id` text NOT NULL,
	`repo_id` text,
	`rel_path` text,
	`class` text NOT NULL,
	`survival` text NOT NULL,
	`frac_committed` real NOT NULL,
	`frac_on_default_branch` real NOT NULL,
	`frac_in_working_tree` real NOT NULL,
	`first_commit_sha` text,
	`first_commit_time` integer,
	`first_commit_subject` text,
	`commit_lag_seconds` real,
	`line_count` integer NOT NULL,
	`computed_at` integer NOT NULL,
	`engine_version` text NOT NULL,
	FOREIGN KEY (`patch_id`) REFERENCES `agent_patches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outcomes_scope_subject_uq` ON `outcomes` (`scope`,`subject_key`);--> statement-breakpoint
CREATE INDEX `outcomes_session_scope_idx` ON `outcomes` (`session_id`,`scope`);--> statement-breakpoint
CREATE INDEX `outcomes_repo_idx` ON `outcomes` (`repo_id`);--> statement-breakpoint
CREATE TABLE `patch_line_fps` (
	`patch_id` text NOT NULL,
	`side` text NOT NULL,
	`ordinal` integer NOT NULL,
	`fp` text NOT NULL,
	PRIMARY KEY(`patch_id`, `side`, `ordinal`),
	FOREIGN KEY (`patch_id`) REFERENCES `agent_patches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`remote_hash` text,
	`default_branch` text,
	`missing` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_indexed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_root_uq` ON `repos` (`root_path`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`parent_session_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_event_at` integer NOT NULL,
	`status` text NOT NULL,
	`cwd` text,
	`repo_id` text,
	`repo_root` text,
	`project_name` text,
	`git_branch_start` text,
	`git_branch_end` text,
	`git_head_start` text,
	`git_head_end` text,
	`model` text,
	`title` text,
	`title_provenance` text,
	`observed_outcome` text,
	`generated_summary` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`changed_file_count` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_input_tokens` integer,
	`reasoning_tokens` integer,
	`usage_coverage` text,
	`estimated_cost_usd` real,
	`source_files` text DEFAULT '[]' NOT NULL,
	`outcome_summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_provider_session_uq` ON `sessions` (`provider`,`provider_session_id`);--> statement-breakpoint
CREATE INDEX `sessions_started_idx` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `sessions_repo_idx` ON `sessions` (`repo_id`);--> statement-breakpoint
CREATE INDEX `sessions_parent_idx` ON `sessions` (`parent_session_id`);--> statement-breakpoint
CREATE TABLE `source_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`path` text NOT NULL,
	`inode` integer NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`byte_offset` integer NOT NULL,
	`parser_version` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_checkpoints_path_uq` ON `source_checkpoints` (`path`);--> statement-breakpoint
CREATE INDEX `source_checkpoints_source_idx` ON `source_checkpoints` (`source_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`root_path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_scan_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_provider_root_uq` ON `sources` (`provider`,`root_path`);--> statement-breakpoint
CREATE TABLE `summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`subject_key` text NOT NULL,
	`input_hash` text NOT NULL,
	`summarizer` text NOT NULL,
	`model` text,
	`output` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `summaries_subject_uq` ON `summaries` (`scope`,`subject_key`,`input_hash`);--> statement-breakpoint
CREATE TABLE `thread_sessions` (
	`thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`thread_id`, `session_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_sessions_session_uq` ON `thread_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`title` text NOT NULL,
	`title_provenance` text NOT NULL,
	`branch` text,
	`status` text NOT NULL,
	`providers` text NOT NULL,
	`link_evidence` text NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_repo_idx` ON `threads` (`repo_id`);--> statement-breakpoint
CREATE INDEX `threads_last_activity_idx` ON `threads` (`last_activity_at`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`usage_key` text NOT NULL,
	`timestamp` integer NOT NULL,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_input_tokens` integer,
	`reasoning_tokens` integer,
	`estimated_cost_usd` real,
	`cost_confidence` text,
	`pricing_version` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_records_session_key_uq` ON `usage_records` (`session_id`,`usage_key`);--> statement-breakpoint
CREATE INDEX `usage_records_ts_idx` ON `usage_records` (`timestamp`);