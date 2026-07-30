CREATE TABLE "settings" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
