CREATE TABLE `agents` (
	`runId` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`runId`, `id`),
	FOREIGN KEY (`runId`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_consolidations` (
	`cycleId` text NOT NULL,
	`agentId` text NOT NULL,
	PRIMARY KEY(`cycleId`, `agentId`),
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `simulation_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`index` integer NOT NULL,
	`status` text NOT NULL,
	`tick` integer NOT NULL,
	`checkpoint` text NOT NULL,
	`outcome` text,
	FOREIGN KEY (`runId`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_decisions` (
	`cycleId` text NOT NULL,
	`id` text NOT NULL,
	`agentId` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`cycleId`, `id`),
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `world_events` (
	`cycleId` text NOT NULL,
	`sequence` integer NOT NULL,
	`tick` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`cycleId`, `sequence`),
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`cycleId` text NOT NULL,
	`agentId` text NOT NULL,
	`tick` integer NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`agentId` text NOT NULL,
	`cycleId` text NOT NULL,
	`type` text NOT NULL,
	`provenance` text NOT NULL,
	`claimKey` text NOT NULL,
	`content` text NOT NULL,
	`confidence` real NOT NULL,
	`importance` real NOT NULL,
	`supersededBy` text,
	`payload` text NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_revisions` (
	`memoryId` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`memoryId`, `revision`),
	FOREIGN KEY (`memoryId`) REFERENCES `agent_memories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `simulation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`worldId` text NOT NULL,
	`configuration` text NOT NULL,
	`status` text NOT NULL,
	`timeScale` integer NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`worldId`) REFERENCES `world_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`cycleId` text NOT NULL,
	`agentId` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`cycleId`, `agentId`),
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `world_snapshots` (
	`cycleId` text NOT NULL,
	`kind` text NOT NULL,
	`tick` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`cycleId`, `kind`),
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`cycleId` text NOT NULL,
	`decisionId` text NOT NULL,
	`index` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`cycleId`, `decisionId`, `index`),
	FOREIGN KEY (`cycleId`) REFERENCES `simulation_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `world_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`seed` integer NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE memory_search USING fts5(content, content='agent_memories', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER memory_search_insert AFTER INSERT ON agent_memories BEGIN
 INSERT INTO memory_search(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER memory_search_delete AFTER DELETE ON agent_memories BEGIN
 INSERT INTO memory_search(memory_search, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER memory_search_update AFTER UPDATE OF content ON agent_memories BEGIN
 INSERT INTO memory_search(memory_search, rowid, content) VALUES ('delete', old.rowid, old.content);
 INSERT INTO memory_search(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE INDEX experiences_scope ON agent_experiences(cycleId, agentId, tick);
--> statement-breakpoint
CREATE INDEX memories_scope ON agent_memories(runId, agentId, claimKey);
--> statement-breakpoint
CREATE UNIQUE INDEX cycles_run_index ON simulation_cycles(runId, "index");
