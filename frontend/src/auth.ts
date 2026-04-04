import { createAuthClient } from "better-auth/client";

// @ts-expect-error Vite defines this at build time
const API_URL = import.meta.env.VITE_API_URL;

export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
});

// State management for current user and session
let currentUser: {
  id: string;
  email: string;
  display_name: string | null;
  createdAt: string;
} | null = null;

// Observable-like state for UI to subscribe to
let listeners: Array<(user: typeof currentUser) => void> = [];

export function subscribeToAuthState(listener: (user: typeof currentUser) => void): () => void {
  listeners.push(listener);
  // Immediately notify with current state
  listener(currentUser);
  // Return unsubscribe function
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function notifyListeners() {
  listeners.forEach((listener) => listener(currentUser));
}

export async function signUp(email: string, password: string, displayName?: string): Promise<void> {
  try {
    const response = await authClient.signUp.email({
      email,
      password,
      name: displayName || email.split("@")[0],
    });

    if (response.data?.user) {
      currentUser = {
        id: response.data.user.id,
        email: response.data.user.email,
        display_name: response.data.user.name || null,
        createdAt: response.data.user.createdAt.toISOString(),
      };
      notifyListeners();
    } else {
      throw response.error || new Error("Sign up failed");
    }
  } catch (error) {
    console.error("Sign up error:", error);
    throw error;
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  try {
    const response = await authClient.signIn.email({
      email,
      password,
    });

    if (response.data?.user) {
      currentUser = {
        id: response.data.user.id,
        email: response.data.user.email,
        display_name: response.data.user.name || null,
        createdAt: response.data.user.createdAt.toISOString(),
      };
      notifyListeners();
    } else {
      throw response.error || new Error("Sign in failed");
    }
  } catch (error) {
    console.error("Sign in error:", error);
    throw error;
  }
}

export async function signInWithGoogle(): Promise<void> {
  try {
    const response = await authClient.signIn.social({
      provider: "google",
    });

    if ((response.data as any)?.user) {
      currentUser = {
        id: (response.data as any).user.id,
        email: (response.data as any).user.email,
        display_name: (response.data as any).user.name || null,
        createdAt: (response.data as any).user.createdAt.toISOString(),
      };
      notifyListeners();
    } else {
      throw (response as any).error || new Error("Google sign in failed");
    }
  } catch (error) {
    console.error("Google sign in error:", error);
    throw error;
  }
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
    currentUser = null;
    notifyListeners();
  } catch (error) {
    console.error("Sign out error:", error);
    currentUser = null;
    notifyListeners();
  }
}

export async function getSession() {
  try {
    const response = await authClient.getSession();
    if ((response.data as any) && "user" in (response.data as any) && (response.data as any).user) {
      currentUser = {
        id: (response.data as any).user.id,
        email: (response.data as any).user.email,
        display_name: (response.data as any).user.name || null,
        createdAt: (response.data as any).user.createdAt.toISOString(),
      };
      return response.data;
    }
  } catch (error) {
    console.error("Get session error:", error);
  }
  return null;
}

export function isAuthenticated(): boolean {
  return currentUser !== null;
}

export function getCurrentUser() {
  return currentUser;
}

// Initialize from session on load
export async function initializeAuth(): Promise<void> {
  try {
    const session = await getSession();
    if (!session) {
      currentUser = null;
    }
  } catch (error) {
    console.error("Failed to restore session:", error);
    currentUser = null;
  }

  notifyListeners();
}
