type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

export function consumeRateLimit(
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

export function clearRateLimitBuckets(): void {
  buckets.clear();
}