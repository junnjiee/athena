CREATE TABLE "battlegrounds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bbox" jsonb NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"cell_meters" real NOT NULL,
	"generated_at" text NOT NULL,
	"weather" jsonb,
	"feature_counts" jsonb NOT NULL,
	"segmentation" jsonb,
	"grid_buffer" "bytea" NOT NULL,
	"features" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"battleground_id" text NOT NULL,
	"name" text NOT NULL,
	"units" jsonb NOT NULL,
	"objectives" jsonb NOT NULL,
	"routes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_battleground_id_battlegrounds_id_fk" FOREIGN KEY ("battleground_id") REFERENCES "public"."battlegrounds"("id") ON DELETE no action ON UPDATE no action;