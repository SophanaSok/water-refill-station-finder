import { Redis } from "@upstash/redis";
import { env } from "../env.js";

function isCacheDisabled(): boolean {
  return (
    env.NODE_ENV === "test" ||
    env.UPSTASH_REDIS_REST_URL.includes("example.upstash.io") ||
    env.UPSTASH_REDIS_REST_TOKEN.startsWith("test-")
  );
}

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export async function getCached<T>(key: string): Promise<T | null> {
  if (isCacheDisabled()) {
    return null;
  }

  let cached: string | null = null;

  try {
    cached = await redis.get<string>(key);
  } catch (error) {
    console.warn("Redis get failed, continuing without cache", { key, error });
    return null;
  }

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
  if (isCacheDisabled()) {
    return;
  }

  const serialized = JSON.stringify(value);
  try {
    await redis.set(key, serialized ?? "null", { ex: ttlSeconds });
  } catch (error) {
    console.warn("Redis set failed, continuing without cache", { key, error });
  }
}