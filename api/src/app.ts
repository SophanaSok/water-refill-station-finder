import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { sql } from "./db/client.js";
import stationsRoutes from "./routes/stations.js";
import geocodeRoutes from "./routes/geocode.js";
import submitRoutes from "./routes/submit.js";
import confirmRoutes from "./routes/confirm.js";
import flagsRoutes from "./routes/flags.js";
import adminRoutes from "./routes/admin.js";

type DbClient = typeof sql;

export type AppOptions = {
  db?: DbClient;
};

export function buildApp(options: AppOptions = {}) {
  const server = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-admin-key",
      ],
    },
    genReqId: (request) => {
      const incomingId = request.headers["x-request-id"];
      return typeof incomingId === "string" && incomingId.trim().length > 0 ? incomingId : randomUUID();
    },
    requestIdHeader: "x-request-id",
    trustProxy: true,
  });

  server.decorate("db", options.db ?? sql);

  server.addHook("onRequest", async (request) => {
    request.startTime = process.hrtime.bigint();
  });

  server.addHook("onResponse", async (request, reply) => {
    const startTime = request.startTime;
    if (!startTime) {
      return;
    }

    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    reply.header("x-response-time-ms", elapsedMs.toFixed(2));

    if (elapsedMs >= 750) {
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          responseTimeMs: elapsedMs,
        },
        "Slow request detected",
      );
    }
  });

  server.setNotFoundHandler((request, reply) => {
    request.log.info({ method: request.method, url: request.url }, "Route not found");
    reply.code(404).send({ error: "Not found" });
  });

  server.setErrorHandler((error, request, reply) => {
    request.log.error(
      {
        err: error,
        method: request.method,
        url: request.url,
        requestId: request.id,
      },
      "Unhandled request error",
    );

    const statusCode = reply.statusCode >= 400 ? reply.statusCode : 500;
    const message = error instanceof Error ? error.message : "Unknown error";
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : message,
      request_id: request.id,
    });
  });

  void server.register(cors, {
    origin: env.FRONTEND_URL,
  });

  void server.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
  });

  void server.register(stationsRoutes, { prefix: "/api/stations" });
  void server.register(geocodeRoutes, { prefix: "/api/geocode" });
  void server.register(submitRoutes, { prefix: "/api/submit" });
  void server.register(confirmRoutes, { prefix: "/api/confirm" });
  void server.register(flagsRoutes, { prefix: "/api/flags" });
  void server.register(adminRoutes, { prefix: "/api/admin" });

  server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  server.get("/ready", async (_request, reply) => {
    try {
      await server.db("SELECT 1", []);
      return {
        status: "ready",
        database: "ok",
        cache: "degraded",
      };
    } catch (error) {
      reply.code(503);
      return {
        status: "not_ready",
        database: "down",
        cache: "degraded",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  return server;
}