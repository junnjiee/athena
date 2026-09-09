CREATE TABLE "operational_area_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"area_id" text NOT NULL,
	"revision" integer NOT NULL,
	"graph_buffer" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operational_areas" ADD COLUMN "current_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "route_studies" ADD COLUMN "graph_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
INSERT INTO "operational_area_revisions" ("id", "area_id", "revision", "graph_buffer", "created_at")
SELECT "id" || ':1', "id", 1, "graph_buffer", "created_at" FROM "operational_areas";--> statement-breakpoint
ALTER TABLE "operational_area_revisions" ADD CONSTRAINT "operational_area_revisions_area_id_operational_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."operational_areas"("id") ON DELETE no action ON UPDATE no action;
