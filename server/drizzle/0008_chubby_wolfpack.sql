CREATE TABLE "course_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text NOT NULL,
	"course_name" text NOT NULL,
	"verdict" text NOT NULL,
	"features" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_weights" (
	"id" text PRIMARY KEY NOT NULL,
	"weights" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_feedback" ADD CONSTRAINT "course_feedback_study_id_route_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."route_studies"("id") ON DELETE no action ON UPDATE no action;