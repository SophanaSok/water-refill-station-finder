import "dotenv/config";
import { env } from "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { sql } from "./db/client.js";
import stationsRoutes from "./routes/stations.js";
import geocodeRoutes from "./routes/geocode.js";
import submitRoutes from "./routes/submit.js";
import confirmRoutes from "./routes/confirm.js";
import flagsRoutes from "./routes/flags.js";
import adminRoutes from "./routes/admin.js";

const server = Fastify({
  logger: env.NODE_ENV !== "production",
  trustProxy: true,
});

server.decorate("db", sql);

await server.register(cors, {
  origin: env.FRONTEND_URL,
});

await server.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

await server.register(stationsRoutes, { prefix: "/api/stations" });
await server.register(geocodeRoutes, { prefix: "/api/geocode" });
await server.register(submitRoutes, { prefix: "/api/submit" });
await server.register(confirmRoutes, { prefix: "/api/confirm" });
await server.register(flagsRoutes, { prefix: "/api/flags" });
await server.register(adminRoutes, { prefix: "/api/admin" });

server.get("/health", async (_request, _reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  server.log.info({ signal }, "Shutting down server");

  try {
    await server.close();
    process.exit(0);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

try {
  await server.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
