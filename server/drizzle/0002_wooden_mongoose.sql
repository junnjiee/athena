CREATE TABLE "simulation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"battleground_id" text NOT NULL,
	"name" text NOT NULL,
	"step_count" integer NOT NULL,
	"soldier_count" integer NOT NULL,
	"replay_log" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_battleground_id_battlegrounds_id_fk" FOREIGN KEY ("battleground_id") REFERENCES "public"."battlegrounds"("id") ON DELETE no action ON UPDATE no action;