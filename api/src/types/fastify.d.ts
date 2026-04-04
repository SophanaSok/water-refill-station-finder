import type { sql } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof sql;
  }
}