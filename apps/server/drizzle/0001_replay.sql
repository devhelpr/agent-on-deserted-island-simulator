CREATE TABLE replay_frames (
 cycle_id TEXT NOT NULL REFERENCES simulation_cycles(id),
 sequence INTEGER NOT NULL,
 tick INTEGER NOT NULL,
 full INTEGER NOT NULL,
 payload TEXT NOT NULL,
 hash TEXT NOT NULL,
 versions TEXT NOT NULL,
 PRIMARY KEY(cycle_id, sequence)
);
--> statement-breakpoint
CREATE INDEX replay_tick ON replay_frames(cycle_id, tick, sequence);
--> statement-breakpoint
CREATE TRIGGER replay_no_update BEFORE UPDATE ON replay_frames BEGIN SELECT RAISE(ABORT, 'Replay history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER replay_no_delete BEFORE DELETE ON replay_frames BEGIN SELECT RAISE(ABORT, 'Replay history is append-only'); END;
