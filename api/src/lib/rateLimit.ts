import { redis } from "../cache/redis.js";
import { env } from "../env.js";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

function isRedisRateLimitDisabled(): boolean {
  return (
    env.NODE_ENV === "test" ||
    env.UPSTASH_REDIS_REST_URL.includes("example.upstash.io") ||
    env.UPSTASH_REDIS_REST_TOKEN.startsWith("test-")
  );
}

function consumeInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; resetAt: number; remaining: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, resetAt, remaining: Math.max(limit - 1, 0) };
  }

  if (existing.count >= limit) {
    return { allowed: false, resetAt: existing.resetAt, remaining: 0 };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return {
    allowed: true,
    resetAt: existing.resetAt,
    remaining: Math.max(limit - existing.count, 0),
  };
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; resetAt: number; remaining: number }> {
  if (isRedisRateLimitDisabled()) {
    return consumeInMemoryRateLimit(key, limit, windowMs);
  }

  const redisKey = `rate-limit:${key}`;

  try {
    const current = await redis.incr(redisKey);

    if (current === 1) {
      await redis.expire(redisKey, Math.max(1, Math.ceil(windowMs / 1000)));
    }

    const ttlMs = await redis.pttl(redisKey);
    const resetAt = ttlMs > 0 ? Date.now() + ttlMs : Date.now() + windowMs;

    if (current > limit) {
      return { allowed: false, resetAt, remaining: 0 };
    }

    return {
      allowed: true,
      resetAt,
      remaining: Math.max(limit - current, 0),
    };
  } catch (error) {
    console.warn("Redis rate limit failed, using in-memory fallback", {
      key,
      error,
    });

    return consumeInMemoryRateLimit(key, limit, windowMs);
  }
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}