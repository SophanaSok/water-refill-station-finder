import { betterAuth } from "better-auth";
import { neon } from "@neondatabase/serverless";
import { env } from "../env.js";

// Create a separate SQL client for BetterAuth that can run queries directly
const authDb = neon(env.DATABASE_URL);

export const auth = betterAuth({
  database: authDb,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  appName: "Water Refill Station Finder",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // Update session age every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // Cache cookies for 5 minutes
    },
  },
  user: {
    additionalFields: {
      display_name: {
        type: "string",
        required: false,
      },
    },
  },
});

export type AuthResponse = {
  user: {
    id: string;
    email: string;
    name?: string;
    display_name?: string;
  };
};

