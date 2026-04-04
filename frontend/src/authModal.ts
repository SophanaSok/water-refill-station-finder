import { signIn, signUp, signInWithGoogle, isAuthenticated } from "./auth.js";

let currentTab: "signin" | "signup" = "signin";
let modalContainer: HTMLDivElement | null = null;

// Inject modal CSS
function injectModalCSS() {
  if (document.getElementById("auth-modal-styles")) return;

  const style = document.createElement("style");
  style.id = "auth-modal-styles";
  style.textContent = `
    .auth-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: flex-end;
      z-index: 1000;
      animation: fadeIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .auth-modal-sheet {
      width: 100%;
      background: var(--color-surface);
      border-radius: 16px 16px 0 0;
      padding: 20px;
      max-height: 90vh;
      overflow-y: auto;
      animation: slideUp 0.3s ease-in-out;
    }

    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }

    @media (min-width: 768px) {
      .auth-modal-overlay {
        align-items: center;
      }

      .auth-modal-sheet {
        width: 100%;
        max-width: 400px;
        border-radius: 16px;
      }
    }

    .auth-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .auth-modal-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--color-text);
      padding: 0;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .auth-modal-tabs {
      display: flex;
      gap: 0;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--color-border);
    }

    .auth-modal-tab {
      flex: 1;
      padding: 12px;
      background: none;
      border: none;
      font-size: var(--font-size-body-sm);
      font-weight: 600;
      cursor: pointer;
      color: var(--color-text-secondary);
      border-bottom: 3px solid transparent;
      transition: all 0.2s ease-in-out;
    }

    .auth-modal-tab.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }

    .auth-modal-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .auth-modal-input {
      padding: 12px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: var(--font-size-body-sm);
      font-family: inherit;
      background: var(--color-surface);
      color: var(--color-text);
    }

    .auth-modal-input::placeholder {
      color: var(--color-text-secondary);
    }

    .auth-modal-input:focus {
      outline: 2px solid var(--color-primary);
      outline-offset: 0;
    }

    .auth-modal-error {
      font-size: var(--font-size-caption);
      color: var(--color-error);
      margin-top: -8px;
    }

    .auth-modal-button {
      padding: 12px 16px;
      border: none;
      border-radius: 8px;
      font-size: var(--font-size-body-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .auth-modal-button.primary {
      background: var(--color-primary);
      color: var(--color-surface);
    }

    .auth-modal-button.primary:active {
      opacity: 0.9;
    }

    .auth-modal-button.secondary {
      background: var(--color-surface);
      color: var(--color-primary);
      border: 1px solid var(--color-primary);
    }

    .auth-modal-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .auth-modal-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 16px 0;
      color: var(--color-text-secondary);
      font-size: var(--font-size-caption);
    }

    .auth-modal-divider::before,
    .auth-modal-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-border);
    }
  `;
  document.head.appendChild(style);
}

function buildModalHTML(): string {
  return `
    <div class="auth-modal-overlay" data-dismiss="true">
      <div class="auth-modal-sheet">
        <div class="auth-modal-header">
          <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">
            ${currentTab === "signin" ? "Sign In" : "Create Account"}
          </h2>
          <button class="auth-modal-close" data-action="close">✕</button>
        </div>

        <div class="auth-modal-tabs">
          <button 
            class="auth-modal-tab ${currentTab === "signin" ? "active" : ""}"
            data-tab="signin"
          >
            Sign In
          </button>
          <button 
            class="auth-modal-tab ${currentTab === "signup" ? "active" : ""}"
            data-tab="signup"
          >
            Sign Up
          </button>
        </div>

        <form class="auth-modal-form" data-form="${currentTab}">
          ${
            currentTab === "signup"
              ? '<input type="text" class="auth-modal-input" data-field="displayName" placeholder="Display name" />'
              : ""
          }
          <input 
            type="email" 
            class="auth-modal-input" 
            data-field="email" 
            placeholder="Email address"
            autocomplete="email"
          />
          <input 
            type="password" 
            class="auth-modal-input" 
            data-field="password" 
            placeholder="Password (min 8 characters)"
            autocomplete="${currentTab === "signin" ? "current-password" : "new-password"}"
          />
          <div class="auth-modal-error" data-field="error"></div>
          <button 
            type="submit" 
            class="auth-modal-button primary"
            data-action="submit"
          >
            ${currentTab === "signin" ? "Sign In" : "Create Account"}
          </button>

          <div class="auth-modal-divider">or</div>

          <button 
            type="button" 
            class="auth-modal-button secondary"
            data-action="google"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  `;
}

export function openAuthModal(): void {
  if (isAuthenticated()) {
    return; // Don't show modal if already authenticated
  }

  injectModalCSS();

  // Remove existing modal if present
  if (modalContainer) {
    modalContainer.remove();
  }

  // Create modal
  modalContainer = document.createElement("div");
  modalContainer.innerHTML = buildModalHTML();
  document.body.appendChild(modalContainer);

  const overlay = modalContainer.querySelector(".auth-modal-overlay") as HTMLDivElement;
  const form = modalContainer.querySelector("form") as HTMLFormElement;
  const emailInput = form.querySelector('input[data-field="email"]') as HTMLInputElement;
  const passwordInput = form.querySelector('input[data-field="password"]') as HTMLInputElement;
  const displayNameInput = form.querySelector('input[data-field="displayName"]') as HTMLInputElement | null;
  const errorDiv = form.querySelector('[data-field="error"]') as HTMLDivElement;

  // Tab switching
  const tabs = modalContainer.querySelectorAll("[data-tab]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const newTab = target.getAttribute("data-tab") as "signin" | "signup";
      if (newTab && newTab !== currentTab) {
        currentTab = newTab;
        openAuthModal(); // Rebuild modal with new tab
      }
    });
  });

  // Form submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const displayName = displayNameInput?.value.trim();

    // Validation
    if (!email || !email.includes("@")) {
      errorDiv.textContent = "Please enter a valid email.";
      return;
    }

    if (password.length < 8) {
      errorDiv.textContent = "Password must be at least 8 characters.";
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    try {
      submitBtn.disabled = true;

      if (currentTab === "signin") {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
      }

      closeAuthModal();
    } catch (error) {
      submitBtn.disabled = false;
      errorDiv.textContent =
        error instanceof Error ? error.message : "Authentication failed. Please try again.";
    }
  });

  // Google sign in
  const googleBtn = form.querySelector('[data-action="google"]') as HTMLButtonElement;
  googleBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      googleBtn.disabled = true;
      await signInWithGoogle();
      closeAuthModal();
    } catch (error) {
      googleBtn.disabled = false;
      errorDiv.textContent = "Google sign in failed. Please try again.";
    }
  });

  // Close handlers
  const closeBtn = modalContainer.querySelector('[data-action="close"]') as HTMLButtonElement;
  closeBtn.addEventListener("click", () => closeAuthModal());

  overlay.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).getAttribute("data-dismiss") === "true") {
      closeAuthModal();
    }
  });
}

export function closeAuthModal(): void {
  if (modalContainer) {
    modalContainer.remove();
    modalContainer = null;
  }
}
