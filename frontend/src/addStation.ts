import maplibregl from "maplibre-gl";
import { geocodeSearch, submitStation } from "./api";
import type { GeocodeResult } from "./api";

// ============================================================================
// Module State
// ============================================================================

let isOpen = false;
let miniMap: maplibregl.Map | null = null;
let miniMapMarker: maplibregl.Marker | null = null;
let currentStep = 1;

// Form state
const formData = {
  // Step 1: Location
  lat: 0,
  lng: 0,
  address: "",
  city: "",
  state: "",
  zip: "",

  // Step 2: Details
  name: "",
  type: "fountain",
  is_free: true,
  cost: "",
  email: "",

  // Step 3: Photo
  photo: null as File | null,
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Open the add station overlay
 */
export function openAddStation(): void {
  if (isOpen) return;

  isOpen = true;
  currentStep = 1;

  const overlay = getOrCreateOverlay();
  overlay.style.display = "flex";

  // Trigger animation
  requestAnimationFrame(() => {
    overlay.classList.add("add-station-visible");
  });

  renderStep(currentStep);
}

/**
 * Close the add station overlay
 */
export function closeAddStation(): void {
  if (!isOpen) return;
  
  // Check if form has unsaved data
  const hasData = formData.name || formData.address || formData.photo;

  if (hasData) {
    const confirmed = confirm("Discard this submission?");
    if (!confirmed) return;
  }

  resetForm();
  isOpen = false;
  currentStep = 1;

  const overlay = getOrCreateOverlay();
  overlay.classList.remove("add-station-visible");

  setTimeout(() => {
    overlay.style.display = "none";
  }, 300);
}

// ============================================================================
// Overlay Management
// ============================================================================

function getOrCreateOverlay(): HTMLElement {
  let overlay = document.querySelector<HTMLElement>("#add-station-overlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "add-station-overlay";
    overlay.className = "add-station-overlay";
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: var(--color-surface);
      z-index: 100;
      display: none;
      flex-direction: column;
      opacity: 0;
      transform: translateY(100%);
      transition: opacity 0.3s ease, transform 0.3s ease;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-4);
      border-bottom: 1px solid var(--color-border);
      flex: 0 0 auto;
    `;

    const title = document.createElement("h1");
    title.textContent = "Add a Water Station";
    title.style.cssText = `
      margin: 0;
      font-size: var(--text-lg);
      flex: 1;
    `;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      border: none;
      background: transparent;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--color-text-muted);
      transition: color var(--transition);
      flex: 0 0 auto;
    `;
    closeBtn.addEventListener("click", closeAddStation);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Content
    const content = document.createElement("div");
    content.id = "add-station-content";
    content.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: var(--space-4);
    `;

    // Progress indicator
    const progress = document.createElement("div");
    progress.id = "add-station-progress";
    progress.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    `;

    overlay.appendChild(header);
    overlay.appendChild(progress);
    overlay.appendChild(content);

    document.body.appendChild(overlay);

    // Inject CSS for animations
    injectStyles();
  }

  return overlay;
}

function injectStyles(): void {
  const styleId = "add-station-styles";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    #add-station-overlay.add-station-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .add-station-mini-map {
      width: 100%;
      height: 200px;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      margin: var(--space-3) 0;
    }

    .add-station-step-content {
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .add-station-form-group {
      margin-bottom: var(--space-4);
      display: grid;
      gap: var(--space-2);
    }

    .add-station-label {
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text);
    }

    .add-station-input {
      padding: var(--space-2);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-surface-elevated);
      font-size: var(--text-sm);
      font-family: inherit;
    }

    .add-station-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent 80%);
    }

    .add-station-radio-group {
      display: grid;
      gap: var(--space-2);
    }

    .add-station-radio-option {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
    }

    .add-station-radio-option:hover {
      border-color: var(--color-primary);
    }

    .add-station-radio-option input[type="radio"] {
      cursor: pointer;
    }

    .add-station-radio-option input[type="radio"]:checked + label {
      font-weight: 600;
      color: var(--color-primary);
    }

    .add-station-toggle {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .add-station-toggle input[type="checkbox"] {
      width: 2.5rem;
      height: 1.5rem;
      cursor: pointer;
    }

    .add-station-photo-upload {
      border: 2px dashed var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-4);
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s ease, background 0.2s ease;
    }

    .add-station-photo-upload:hover {
      border-color: var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 5%, transparent 95%);
    }

    .add-station-photo-preview {
      width: 100%;
      max-height: 200px;
      object-fit: cover;
      border-radius: var(--radius-md);
      margin-top: var(--space-2);
    }

    .add-station-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
      margin-top: var(--space-4);
      position: sticky;
      bottom: 0;
      background: var(--color-surface);
      padding: var(--space-4);
      border-top: 1px solid var(--color-border);
    }

    .add-station-buttons.single {
      grid-template-columns: 1fr;
    }

    .add-station-success {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-4);
      text-align: center;
      min-height: 50vh;
      animation: fadeIn 0.3s ease-in;
    }

    .add-station-success-checkmark {
      width: 5rem;
      height: 5rem;
      border-radius: 50%;
      background: color-mix(in srgb, #22c55e 20%, transparent 80%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
      animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes scaleIn {
      from {
        transform: scale(0);
      }
      to {
        transform: scale(1);
      }
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .add-station-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: var(--space-2);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-surface-elevated);
      box-shadow: var(--shadow-lg);
      z-index: 51;
      max-height: 50vh;
      overflow-y: auto;
    }

    .add-station-dropdown ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .add-station-dropdown li {
      border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent 50%);
    }

    .add-station-dropdown li:last-child {
      border-bottom: none;
    }

    .add-station-dropdown button {
      width: 100%;
      padding: var(--space-2) var(--space-3);
      background: none;
      border: none;
      text-align: left;
      cursor: pointer;
      font-size: var(--text-sm);
      transition: background 0.15s ease;
    }

    .add-station-dropdown button:hover {
      background: color-mix(in srgb, var(--color-primary) 8%, transparent 92%);
    }
  `;

  document.head.appendChild(style);
}

// ============================================================================
// Step Rendering
// ============================================================================

function renderStep(step: number): void {
  const content = getElement<HTMLDivElement>("#add-station-content");
  const progress = getElement<HTMLDivElement>("#add-station-progress");

  // Update progress
  progress.innerHTML = `
    <span>${step === 1 ? "🌍" : step === 2 ? "📋" : "📷"}</span>
    <span>Step ${step} of 3</span>
  `;

  // Clear content
  content.innerHTML = "";

  // Render step content
  const stepDiv = document.createElement("div");
  stepDiv.className = "add-station-step-content";

  if (step === 1) {
    stepDiv.appendChild(renderStep1());
  } else if (step === 2) {
    stepDiv.appendChild(renderStep2());
  } else if (step === 3) {
    stepDiv.appendChild(renderStep3());
  }

  content.appendChild(stepDiv);

  // Attach event listeners
  if (step === 1) attachStep1Listeners();
  else if (step === 2) attachStep2Listeners();
  else if (step === 3) attachStep3Listeners();
}

function renderStep1(): HTMLElement {
  const container = document.createElement("div");

  // Instructions
  const instructions = document.createElement("p");
  instructions.textContent = "Search for the address or tap the map to drop a pin";
  instructions.style.cssText = `
    margin: 0 0 var(--space-3) 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  `;

  // Address search
  const searchGroup = document.createElement("div");
  searchGroup.className = "add-station-form-group";
  searchGroup.style.position = "relative";

  const searchLabel = document.createElement("label");
  searchLabel.className = "add-station-label";
  searchLabel.textContent = "Address";

  const searchInput = document.createElement("input");
  searchInput.id = "add-station-address-search";
  searchInput.type = "text";
  searchInput.className = "add-station-input";
  searchInput.placeholder = "123 Main St";
  searchInput.autocomplete = "off";

  const dropdown = document.createElement("div");
  dropdown.id = "add-station-search-dropdown";
  dropdown.className = "add-station-dropdown";
  dropdown.style.display = "none";

  searchGroup.appendChild(searchLabel);
  searchGroup.appendChild(searchInput);
  searchGroup.appendChild(dropdown);

  // Mini-map
  const mapContainer = document.createElement("div");
  mapContainer.id = "add-station-mini-map";
  mapContainer.className = "add-station-mini-map";

  // Address info (populated from search)
  const addressFields = document.createElement("div");
  addressFields.id = "add-station-address-fields";
  addressFields.style.display = "grid";
  addressFields.style.gap = "var(--space-2)";
  addressFields.style.marginTop = "var(--space-3)";

  const addressField = createTextField("add-station-address", "Address", formData.address);
  const cityField = createTextField("add-station-city", "City", formData.city);
  const stateField = createTextField("add-station-state", "State", formData.state);
  const zipField = createTextField("add-station-zip", "ZIP", formData.zip);

  addressFields.appendChild(addressField);
  addressFields.appendChild(cityField);
  addressFields.appendChild(stateField);
  addressFields.appendChild(zipField);

  // Buttons
  const buttons = createStepButtons(1);

  container.appendChild(instructions);
  container.appendChild(searchGroup);
  container.appendChild(mapContainer);
  container.appendChild(addressFields);
  container.appendChild(buttons);

  return container;
}

function renderStep2(): HTMLElement {
  const container = document.createElement("div");

  // Name
  const nameField = createTextField("add-station-name", "What is this station called?", formData.name, "City Park Fountain");

  // Type
  const typeGroup = document.createElement("div");
  typeGroup.className = "add-station-form-group";

  const typeLabel = document.createElement("label");
  typeLabel.className = "add-station-label";
  typeLabel.textContent = "Type";

  const typeOptions = document.createElement("div");
  typeOptions.className = "add-station-radio-group";

  ["fountain", "bottle_filler", "store_refill", "tap"].forEach((type) => {
    const label = document.createElement("label");
    label.className = "add-station-radio-option";
    label.style.cursor = "pointer";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "type";
    radio.value = type;
    radio.checked = formData.type === type;

    const icons: Record<string, string> = {
      fountain: "💧 Drinking Fountain",
      bottle_filler: "🍶 Bottle Filler",
      store_refill: "🏪 Store Refill Station",
      tap: "🚰 Tap / Spigot",
    };

    const span = document.createElement("span");
    span.textContent = icons[type] ?? type;

    label.appendChild(radio);
    label.appendChild(span);
    typeOptions.appendChild(label);
  });

  typeGroup.appendChild(typeLabel);
  typeGroup.appendChild(typeOptions);

  // Free toggle
  const freeGroup = document.createElement("div");
  freeGroup.className = "add-station-form-group";

  const freeLabel = document.createElement("label");
  freeLabel.className = "add-station-label";
  freeLabel.textContent = "Free?";

  const freeToggle = document.createElement("div");
  freeToggle.className = "add-station-toggle";

  const freeCheckbox = document.createElement("input");
  freeCheckbox.id = "add-station-free";
  freeCheckbox.type = "checkbox";
  freeCheckbox.checked = formData.is_free;

  const freeToggleLabel = document.createElement("label");
  freeToggleLabel.htmlFor = "add-station-free";
  freeToggleLabel.textContent = formData.is_free ? "Free" : "Not free";
  freeToggleLabel.style.cursor = "pointer";

  freeToggle.appendChild(freeCheckbox);
  freeToggle.appendChild(freeToggleLabel);

  freeGroup.appendChild(freeLabel);
  freeGroup.appendChild(freeToggle);

  // Cost field (hidden by default)
  const costField = createTextField("add-station-cost", "Cost per unit", formData.cost, "$0.25/gallon");
  costField.style.display = formData.is_free ? "none" : "grid";
  costField.id = "add-station-cost-field";

  // Email
  const emailField = createTextField("add-station-email", "Your email", formData.email, "for submission updates");

  // Buttons
  const buttons = createStepButtons(2);

  container.appendChild(nameField);
  container.appendChild(typeGroup);
  container.appendChild(freeGroup);
  container.appendChild(costField);
  container.appendChild(emailField);
  container.appendChild(buttons);

  return container;
}

function renderStep3(): HTMLElement {
  const container = document.createElement("div");

  // Upload area
  const uploadGroup = document.createElement("div");
  uploadGroup.className = "add-station-form-group";

  const uploadLabel = document.createElement("label");
  uploadLabel.className = "add-station-label";
  uploadLabel.textContent = "Photo (Optional)";

  const uploadArea = document.createElement("div");
  uploadArea.id = "add-station-photo-upload";
  uploadArea.className = "add-station-photo-upload";
  uploadArea.style.cursor = "pointer";

  const uploadText = document.createElement("div");
  uploadText.style.fontSize = "3rem";
  uploadText.style.marginBottom = "var(--space-2)";
  uploadText.textContent = "📷";

  const uploadHint = document.createElement("p");
  uploadHint.style.margin = "0";
  uploadHint.style.color = "var(--color-text-muted)";
  uploadHint.style.fontSize = "var(--text-sm)";
  uploadHint.textContent = "Take a photo or upload from library";

  const uploadDetails = document.createElement("p");
  uploadDetails.style.margin = "var(--space-1) 0 0 0";
  uploadDetails.style.color = "var(--color-text-muted)";
  uploadDetails.style.fontSize = "var(--text-xs)";
  uploadDetails.textContent = "JPG, PNG, WebP • Max 5MB";

  uploadArea.appendChild(uploadText);
  uploadArea.appendChild(uploadHint);
  uploadArea.appendChild(uploadDetails);

  // File input (hidden)
  const fileInput = document.createElement("input");
  fileInput.id = "add-station-file-input";
  fileInput.type = "file";
  fileInput.accept = "image/jpeg,image/png,image/webp";
  fileInput.style.display = "none";

  // Preview
  const preview = document.createElement("img");
  preview.id = "add-station-photo-preview";
  preview.className = "add-station-photo-preview";
  preview.style.display = formData.photo ? "block" : "none";

  if (formData.photo) {
    preview.src = URL.createObjectURL(formData.photo);
  }

  uploadGroup.appendChild(uploadLabel);
  uploadGroup.appendChild(uploadArea);
  uploadGroup.appendChild(fileInput);
  uploadGroup.appendChild(preview);

  // Buttons (single button layout for submit)
  const buttons = createStepButtons(3);

  container.appendChild(uploadGroup);
  container.appendChild(buttons);

  return container;
}

// ============================================================================
// Helper Functions
// ============================================================================

function createTextField(
  id: string,
  label: string,
  value: string,
  placeholder?: string,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "add-station-form-group";

  const labelEl = document.createElement("label");
  labelEl.className = "add-station-label";
  labelEl.setAttribute("for", id);
  labelEl.textContent = label;

  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.className = "add-station-input";
  input.value = value;
  if (placeholder) input.placeholder = placeholder;

  group.appendChild(labelEl);
  group.appendChild(input);

  return group;
}

function createStepButtons(step: number): HTMLElement {
  const buttons = document.createElement("div");
  buttons.className = `add-station-buttons ${step === 3 ? "single" : ""}`;

  if (step > 1) {
    const backBtn = document.createElement("button");
    backBtn.className = "btn-ghost";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => {
      currentStep--;
      renderStep(currentStep);
    });
    buttons.appendChild(backBtn);
  }

  if (step < 3) {
    const nextBtn = document.createElement("button");
    nextBtn.className = "btn-primary";
    nextBtn.textContent = "Next →";
    nextBtn.addEventListener("click", () => {
      if (validateStep(step)) {
        currentStep++;
        renderStep(currentStep);
      }
    });
    buttons.appendChild(nextBtn);
  } else {
    const submitBtn = document.createElement("button");
    submitBtn.id = "add-station-submit";
    submitBtn.className = "btn-primary";
    submitBtn.textContent = "Submit";
    buttons.appendChild(submitBtn);
  }

  return buttons;
}

function getElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

// ============================================================================
// Event Listeners
// ============================================================================

function attachStep1Listeners(): void {
  const searchInput = getElement<HTMLInputElement>("#add-station-address-search");
  const dropdown = getElement<HTMLDivElement>("#add-station-search-dropdown");

  searchInput.addEventListener("input", async (e) => {
    const query = (e.target as HTMLInputElement).value;

    if (query.length < 2) {
      dropdown.style.display = "none";
      return;
    }

    try {
      const results = await geocodeSearch(query);
      renderSearchDropdown(results, dropdown);
      dropdown.style.display = "block";
    } catch (error) {
      console.error("Geocode search failed:", error);
      dropdown.style.display = "none";
    }
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  });

  // Initialize mini-map
  setTimeout(() => {
    initializeMiniMap();
  }, 100);
}

function attachStep2Listeners(): void {
  // Type radio buttons
  document.querySelectorAll('input[name="type"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      formData.type = (e.target as HTMLInputElement).value;
    });
  });

  // Free toggle
  const freeCheckbox = getElement<HTMLInputElement>("#add-station-free");
  freeCheckbox.addEventListener("change", (e) => {
    formData.is_free = (e.target as HTMLInputElement).checked;

    const costField = queryElement<HTMLDivElement>("#add-station-cost-field");
    if (costField) {
      costField.style.display = formData.is_free ? "none" : "grid";
    }
  });
}

function attachStep3Listeners(): void {
  const uploadArea = getElement<HTMLDivElement>("#add-station-photo-upload");
  const fileInput = getElement<HTMLInputElement>("#add-station-file-input");
  const submitBtn = getElement<HTMLButtonElement>("#add-station-submit");

  uploadArea.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large. Max 5MB.");
      fileInput.value = "";
      return;
    }

    // Validate file type
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      alert("Invalid file type. Accepted: JPG, PNG, WebP");
      fileInput.value = "";
      return;
    }

    formData.photo = file;

    // Show preview
    const preview = getElement<HTMLImageElement>("#add-station-photo-preview");
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
  });

  submitBtn.addEventListener("click", () => {
    handleSubmit();
  });
}

function renderSearchDropdown(results: GeocodeResult[], dropdown: HTMLDivElement): void {
  const ul = document.createElement("ul");

  results.forEach((result) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = result.place_name;

    btn.addEventListener("click", (e) => {
      e.preventDefault();

      // Populate form fields
      const parts = result.place_name.split(", ");
      const address = parts[0] ?? "";
      const city = parts[1] ?? "";
      const state = parts[2] ?? "";

      formData.lat = result.center[1];
      formData.lng = result.center[0];
      formData.address = address;
      formData.city = city;
      formData.state = state;

      // Update input fields
      const searchInput = getElement<HTMLInputElement>("#add-station-address-search");
      searchInput.value = result.place_name;

      const addressInput = queryElement<HTMLInputElement>("#add-station-address");
      const cityInput = queryElement<HTMLInputElement>("#add-station-city");
      const stateInput = queryElement<HTMLInputElement>("#add-station-state");

      if (addressInput) addressInput.value = address;
      if (cityInput) cityInput.value = city;
      if (stateInput) stateInput.value = state;

      // Update mini-map
      if (miniMapMarker) {
        miniMapMarker.setLngLat([result.center[0], result.center[1]]);
      }
      if (miniMap) {
        miniMap.flyTo({ center: result.center, zoom: 14 });
      }

      dropdown.style.display = "none";
    });

    li.appendChild(btn);
    ul.appendChild(li);
  });

  dropdown.innerHTML = "";
  dropdown.appendChild(ul);
}

function initializeMiniMap(): void {
  const container = queryElement<HTMLElement>("#add-station-mini-map");
  if (!container || container.offsetHeight === 0) return;

  if (miniMap) miniMap.remove();

  // Default to US center if no location set yet
  const center: [number, number] = (formData.lng !== 0 && formData.lat !== 0) 
    ? [formData.lng, formData.lat] 
    : [-98.5, 39.5];

  miniMap = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center,
    zoom: formData.lat ? 14 : 4,
  });

  miniMap.on("load", () => {
    // Add draggable marker
    const markerLngLat: [number, number] = (formData.lng !== 0 && formData.lat !== 0)
      ? [formData.lng, formData.lat]
      : [-98.5, 39.5];
    miniMapMarker = new maplibregl.Marker({ draggable: true })
      .setLngLat(markerLngLat)
      .addTo(miniMap!);

    miniMapMarker.on("dragend", () => {
      const lngLat = miniMapMarker!.getLngLat();
      formData.lat = lngLat.lat;
      formData.lng = lngLat.lng;
    });
  });
}

// ============================================================================
// Validation
// ============================================================================

function validateStep(step: number): boolean {
  if (step === 1) {
    if (!formData.lat || !formData.lng) {
      alert("Please select a location on the map");
      return false;
    }
  } else if (step === 2) {
    if (!formData.name.trim()) {
      alert("Please enter a station name");
      return false;
    }
    if (!formData.email.trim()) {
      alert("Please enter your email");
      return false;
    }
    // Update form data from inputs
    const nameInput = queryElement<HTMLInputElement>("#add-station-name");
    const emailInput = queryElement<HTMLInputElement>("#add-station-email");
    const costInput = queryElement<HTMLInputElement>("#add-station-cost");

    if (nameInput) formData.name = nameInput.value;
    if (emailInput) formData.email = emailInput.value;
    if (costInput && !formData.is_free) formData.cost = costInput.value;
  }

  return true;
}

// ============================================================================
// Form Submission
// ============================================================================

async function handleSubmit(): Promise<void> {
  const submitBtn = getElement<HTMLButtonElement>("#add-station-submit");
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    // Gather all form data
    const fd = new FormData();
    fd.append("name", formData.name);
    fd.append("type", formData.type);
    fd.append("is_free", String(formData.is_free));
    if (!formData.is_free) fd.append("cost", formData.cost);
    fd.append("address", formData.address);
    fd.append("city", formData.city);
    fd.append("state", formData.state);
    fd.append("zip", formData.zip);
    fd.append("latitude", String(formData.lat));
    fd.append("longitude", String(formData.lng));
    fd.append("email", formData.email);

    if (formData.photo) {
      fd.append("photo", formData.photo);
    }

    // Submit
    await submitStation(fd);

    // Show success state
    showSuccessState(formData.email);

    // Reset after successful submission
    setTimeout(() => {
      resetForm();
    }, 5000);
  } catch (error) {
    console.error("Failed to submit station:", error);
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;

    const errorMsg = error instanceof Error ? error.message : "Submission failed";
    alert(errorMsg);
  }
}

function showSuccessState(email: string): void {
  const content = getElement<HTMLDivElement>("#add-station-content");

  const success = document.createElement("div");
  success.className = "add-station-success";

  const checkmark = document.createElement("div");
  checkmark.className = "add-station-success-checkmark";
  checkmark.textContent = "✓";

  const thanks = document.createElement("h2");
  thanks.style.margin = "0";
  thanks.style.fontSize = "var(--text-lg)";
  thanks.textContent = `Thank you, ${escapeHtml(email.split("@")[0])}!`;

  const message = document.createElement("p");
  message.style.color = "var(--color-text-muted)";
  message.style.margin = "0";
  message.textContent = "Your submission is under review. We'll verify it shortly.";

  const buttonsDiv = document.createElement("div");
  buttonsDiv.style.display = "grid";
  buttonsDiv.style.gridTemplateColumns = "1fr 1fr";
  buttonsDiv.style.gap = "var(--space-2)";
  buttonsDiv.style.marginTop = "var(--space-4)";

  const addAnotherBtn = document.createElement("button");
  addAnotherBtn.className = "btn-secondary";
  addAnotherBtn.textContent = "Add another";
  addAnotherBtn.addEventListener("click", () => {
    resetForm();
    currentStep = 1;
    renderStep(currentStep);
  });

  const doneBtn = document.createElement("button");
  doneBtn.className = "btn-primary";
  doneBtn.textContent = "Done";
  doneBtn.addEventListener("click", closeAddStation);

  buttonsDiv.appendChild(addAnotherBtn);
  buttonsDiv.appendChild(doneBtn);

  success.appendChild(checkmark);
  success.appendChild(thanks);
  success.appendChild(message);
  success.appendChild(buttonsDiv);

  content.innerHTML = "";
  content.appendChild(success);
}

// ============================================================================
// Utilities
// ============================================================================

function resetForm(): void {
  formData.lat = 0;
  formData.lng = 0;
  formData.address = "";
  formData.city = "";
  formData.state = "";
  formData.zip = "";
  formData.name = "";
  formData.type = "fountain";
  formData.is_free = true;
  formData.cost = "";
  formData.email = "";
  formData.photo = null;

  if (miniMap) {
    miniMap.remove();
    miniMap = null;
    miniMapMarker = null;
  }
}

function queryElement<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c] ?? "");
}
