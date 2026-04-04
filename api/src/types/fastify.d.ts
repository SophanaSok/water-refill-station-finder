import type { sql } from "../db/client.js";

declare module "fastify" {
  interface FastifyRequest {
    startTime?: bigint;
  }

  interface FastifyInstance {
    db: typeof sql;
  }
}