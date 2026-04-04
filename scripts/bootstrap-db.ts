import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { seedStations } from "./osm-import.js";

type EnvFileValue = Record<string, string>;

const ENV_PATHS = ["../api/.env", "../.env"];

function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDollarQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextChar = sql[index + 1];

    if (!inSingleQuote && char === "$" && nextChar === "$") {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      index += 1;
      continue;
    }

    if (!inDollarQuote && char === "'" && sql[index - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDollarQuote && char === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push(`${statement};`);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function parseEnvFile(content: string): EnvFileValue {
  const values: EnvFileValue = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    values[key.trim()] = value;
  }

  return values;
}

async function resolveDatabaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  for (const envPath of ENV_PATHS) {
    try {
      const raw = await readFile(new URL(envPath, import.meta.url), "utf8");
      const parsed = parseEnvFile(raw);
      if (parsed.DATABASE_URL) {
        return parsed.DATABASE_URL;
      }
    } catch {
      continue;
    }
  }

  throw new Error("DATABASE_URL is required to bootstrap the database");
}

async function applySchema(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  const schema = await readFile(new URL("../api/src/db/schema.sql", import.meta.url), "utf8");
  const statements = splitSql(schema);

  for (const statement of statements) {
    await sql(statement);
  }

  console.log(`Applied ${statements.length} schema statement(s).`);
}

async function main(): Promise<void> {
  const databaseUrl = await resolveDatabaseUrl();
  await applySchema(databaseUrl);
  await seedStations(databaseUrl);
}

main().catch((error: unknown) => {
  console.error("Database bootstrap failed:", error);
  process.exitCode = 1;
});