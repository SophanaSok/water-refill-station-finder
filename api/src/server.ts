import "dotenv/config";
import { env } from "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

const server = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "warn" : "info",
  },
});

await server.register(cors, {
  origin: env.NODE_ENV === "production" ? false : true,
});

await server.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

server.get("/health", async (_request, _reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

const start = async () => {
  try {
    await server.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

await start();
