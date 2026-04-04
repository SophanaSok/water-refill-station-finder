import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MAPBOX_SECRET_TOKEN: z.string().min(1, "MAPBOX_SECRET_TOKEN is required"),
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url("UPSTASH_REDIS_REST_URL must be a valid URL"),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, "UPSTASH_REDIS_REST_TOKEN is required"),
  PORT: z
    .string()
    .optional()
    .default("3000")
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.errors
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Missing or invalid environment variables:\n${missing}`);
  }

  return result.data;
}

export const env = validateEnv();
export type Env = typeof env;
