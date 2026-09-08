CREATE TABLE "route_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"area_id" text NOT NULL,
	"name" text NOT NULL,
	"marks" jsonb NOT NULL,
	"edge_overrides" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"corridor_edits" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_area_id_operational_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."operational_areas"("id") ON DELETE no action ON UPDATE no action;