import { getCurrentUser, signOut, subscribeToAuthState } from "./auth.js";
import { openAuthModal } from "./authModal.js";

let profileSheetOpen = false;
let profileSheetContainer: HTMLDivElement | null = null;
let submissionCount = 0;

// Inject profile styles
function injectProfileCSS() {
  if (document.getElementById("profile-sheet-styles")) return;

  const style = document.createElement("style");
  style.id = "profile-sheet-styles";
  style.textContent = `
    .profile-sheet-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      z-index: 999;
      animation: fadeIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .profile-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
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
      .profile-sheet {
        position: fixed;
        max-width: 600px;
        left: 50%;
        transform: translateX(-50%);
        border-radius: 16px;
        bottom: 50%;
        top: auto;
        translate: none;
        transform: translateX(-50%) translateY(50%);
      }

      .profile-sheet-overlay {
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }

    .profile-sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .profile-sheet-close {
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

    .profile-content {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .profile-user-info {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      background: var(--color-background);
      border-radius: 12px;
    }

    .profile-user-name {
      font-size: var(--font-size-body);
      font-weight: 600;
      color: var(--color-text);
    }

    .profile-user-email {
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
    }

    .profile-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .profile-stat {
      padding: 12px;
      background: var(--color-background);
      border-radius: 12px;
      text-align: center;
    }

    .profile-stat-value {
      font-size: var(--font-size-heading-sm);
      font-weight: 600;
      color: var(--color-primary);
    }

    .profile-stat-label {
      font-size: var(--font-size-caption);
      color: var(--color-text-secondary);
      margin-top: 4px;
    }

    .profile-button {
      padding: 12px 16px;
      border: none;
      border-radius: 8px;
      font-size: var(--font-size-body-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .profile-button.primary {
      background: var(--color-primary);
      color: var(--color-surface);
      width: 100%;
    }

    .profile-button.primary:active {
      opacity: 0.9;
    }

    .profile-button.danger {
      background: rgba(220, 38, 38, 0.1);
      color: #dc2626;
      width: 100%;
    }

    .profile-unauthenticated {
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: center;
    }

    .profile-unauthenticated-message {
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
      margin-bottom: 12px;
    }

    .profile-button-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .profile-button.secondary {
      background: var(--color-surface);
      color: var(--color-primary);
      border: 1px solid var(--color-primary);
    }
  `;
  document.head.appendChild(style);
}

function buildProfileHTML(user: ReturnType<typeof getCurrentUser>): string {
  if (!user) {
    return `
      <div class="profile-sheet-overlay" data-dismiss="true">
        <div class="profile-sheet">
          <div class="profile-sheet-header">
            <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Profile</h2>
            <button class="profile-sheet-close" data-action="close">✕</button>
          </div>

          <div class="profile-content">
            <div class="profile-unauthenticated">
              <p class="profile-unauthenticated-message">
                Sign in to save your favorite stations and track your contributions.
              </p>
              <div class="profile-button-group">
                <button class="profile-button primary" data-action="signin">
                  Sign In / Sign Up
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="profile-sheet-overlay" data-dismiss="true">
      <div class="profile-sheet">
        <div class="profile-sheet-header">
          <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Profile</h2>
          <button class="profile-sheet-close" data-action="close">✕</button>
        </div>

        <div class="profile-content">
          <div class="profile-user-info">
            <div class="profile-user-name">${user.display_name || user.email.split("@")[0]}</div>
            <div class="profile-user-email">${user.email}</div>
          </div>

          <div class="profile-stats">
            <div class="profile-stat">
              <div class="profile-stat-value">${submissionCount}</div>
              <div class="profile-stat-label">Submissions</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">✓</div>
              <div class="profile-stat-label">Saved Stations</div>
            </div>
          </div>

          <button class="profile-button danger" data-action="signout">
            Sign Out
          </button>
        </div>
      </div>
    </div>
  `;
}

export function openProfileSheet(): void {
  injectProfileCSS();

  // Remove existing profile sheet if present
  if (profileSheetContainer) {
    profileSheetContainer.remove();
  }

  const user = getCurrentUser();
  profileSheetContainer = document.createElement("div");
  profileSheetContainer.innerHTML = buildProfileHTML(user);
  document.body.appendChild(profileSheetContainer);
  profileSheetOpen = true;

  // Fetch submission count if authenticated
  if (user) {
    // Note: This would fetch from a new backend endpoint like GET /api/profile/submissions
    // For now, we'll just use a placeholder value
  }

  // Event handlers
  const overlay = profileSheetContainer.querySelector(".profile-sheet-overlay") as HTMLDivElement;
  const closeBtn = profileSheetContainer.querySelector('[data-action="close"]') as HTMLButtonElement;
  const signinBtn = profileSheetContainer.querySelector('[data-action="signin"]') as HTMLButtonElement | null;
  const signoutBtn = profileSheetContainer.querySelector('[data-action="signout"]') as HTMLButtonElement | null;

  closeBtn.addEventListener("click", closeProfileSheet);

  overlay.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).getAttribute("data-dismiss") === "true") {
      closeProfileSheet();
    }
  });

  if (signinBtn) {
    signinBtn.addEventListener("click", () => {
      closeProfileSheet();
      openAuthModal();
    });
  }

  if (signoutBtn) {
    signoutBtn.addEventListener("click", async () => {
      await signOut();
      closeProfileSheet();
      // Update UI to reflect user is logged out
      updateProfileTabUI();
    });
  }
}

export function closeProfileSheet(): void {
  if (profileSheetContainer) {
    profileSheetContainer.remove();
    profileSheetContainer = null;
    profileSheetOpen = false;
  }
}

export function isProfileSheetOpen(): boolean {
  return profileSheetOpen;
}

// Update profile tab UI based on auth state
export function updateProfileTabUI(): void {
  const profileTab = document.querySelector("#tab-profile") as HTMLButtonElement | null;
  if (!profileTab) return;

  const user = getCurrentUser();
  const icon = profileTab.querySelector("span") as HTMLSpanElement;

  if (user && user.display_name) {
    icon.textContent = user.display_name.charAt(0).toUpperCase();
    profileTab.title = user.email;
  } else if (user) {
    icon.textContent = user.email.charAt(0).toUpperCase();
    profileTab.title = user.email;
  } else {
    icon.textContent = "👤";
    profileTab.title = "Sign in to your account";
  }
}

// Initialize profile with auth state subscription
export function initializeProfile(): void {
  subscribeToAuthState(() => {
    updateProfileTabUI();
  });

  updateProfileTabUI();
}
