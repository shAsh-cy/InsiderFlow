import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Falls back to the docker-compose database for local development.
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/insiderflow",
  },
  strict: true,
  verbose: true,
});
