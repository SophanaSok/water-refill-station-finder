import "dotenv/config";
import { env } from "./env.js";
import { buildApp } from "./app.js";

const server = buildApp();

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
