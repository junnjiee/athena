CREATE TABLE "simulation_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"battleground_id" text NOT NULL,
	"simulation_count" integer NOT NULL,
	"ticks" integer NOT NULL,
	"model" text,
	"soldiers" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simulation_batches" ADD CONSTRAINT "simulation_batches_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_batches" ADD CONSTRAINT "simulation_batches_battleground_id_battlegrounds_id_fk" FOREIGN KEY ("battleground_id") REFERENCES "public"."battlegrounds"("id") ON DELETE no action ON UPDATE no action;