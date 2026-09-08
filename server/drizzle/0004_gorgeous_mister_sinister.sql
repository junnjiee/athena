CREATE TABLE "operational_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bbox" jsonb NOT NULL,
	"generated_at" text NOT NULL,
	"node_count" integer NOT NULL,
	"edge_count" integer NOT NULL,
	"dem_resolution_meters" real NOT NULL,
	"graph_buffer" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
