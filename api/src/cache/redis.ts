import { Redis } from "@upstash/redis";
import { env } from "../env.js";

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export async function getCached<T>(key: string): Promise<T | null> {
  const cached = await redis.get<string>(key);

  if (cached === null) {
    return null;
  }

  try {
    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
}

export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const serialized = JSON.stringify(value);
  await redis.set(key, serialized ?? "null", { ex: ttlSeconds });
}