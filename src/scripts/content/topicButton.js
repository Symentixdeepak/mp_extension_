// topicButton.js - Fixed version for first-load issues

const { showNotification } = require("../../utils/notification");
const {
  populateBoards,
  updateLocalStorageObject,
} = require("../../utils/utils");

// Global state to track current button state
let currentButtonState = null;
let renderInProgress = false;
let isInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 10;

// Check if user has auth token
async function checkAuthToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "GET_AUTH_TOKEN" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting auth token:", chrome.runtime.lastError);
        resolve(false);
        return;
      }
      const hasToken = !!response?.token;
      console.log("Auth token check:", hasToken ? "Found" : "Not found");
      resolve(hasToken);
    });
  });
}

// Enhanced page readiness check
async function waitForPageReady(maxRetries = 15, retryDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    // Check if we're on the right page
    if (!/^\/search\/results\/content(\/|$)/.test(window.location.pathname)) {
      console.log("Not on content search page, skipping wait");
      return false;
    }

    // Check for LinkedIn's app container and search elements
    const appContainer =
      document.querySelector("#global-nav") ||
      document.querySelector(".application-outlet") ||
      document.querySelector("main");

    const searchContainer =
      document.querySelector(".search-results-container") ||
      document.querySelector('[data-view-name="search-results"]') ||
      document.querySelector(".search-results");

    if (appContainer && searchContainer) {
      console.log(`Page ready on attempt ${i + 1}`);
      // Additional wait for filters bar to be ready
      try {
        await waitForFiltersBar(10, 500);
        return true;
      } catch (error) {
        console.log(`Filters bar not ready yet, attempt ${i + 1}`);
      }
    }

    if (i < maxRetries - 1) {
      console.log(`Page not ready, attempt ${i + 1}/${maxRetries}`);
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }

  console.warn(`Page not ready after ${maxRetries} attempts`);
  return false;
}

// Fetch workspace boards from the background script
async function fetchWorkspaces() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "FETCH_BOARDS_TOPIC_LIST_BG" },
      (response) => {
        if (response && response.success) {
          resolve(response?.data || []);
        } else {
          showNotification("Failed to fetch workspaces", "error");
          resolve([]);
        }
      }
    );
  });
}

// Fetch contact types from background script
async function fetchContactTypes(businessId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "FETCH_CONTACT_TYPES_BG_TOPIC",
        businessId: businessId,
      },
      (response) => {
        if (response && response.success) {
          resolve(response?.data?.data?.rows || []);
        } else {
          console.error("Failed to fetch contact types:", response?.error);
          resolve([]);
        }
      }
    );
  });
}

// Create new contact type
async function createContactType(businessId, name) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "CREATE_CONTACT_TYPE_BG",
        businessId: businessId,
        name: name,
      },
      (response) => {
        if (response && response.success) {
          resolve(response.data?.data);
        } else {
          reject(new Error(response?.error || "Failed to create contact type"));
        }
      }
    );
  });
}

// Normalize URLs: Keep query parameters but exclude dynamic sid parameter
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const normalizedPathname = u.pathname.replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(u.search);
    const filteredParams = new URLSearchParams();

    Array.from(params.keys()).forEach((key) => {
      if (key !== "sid") {
        filteredParams.set(key, params.get(key));
      }
    });

    const sortedParams = new URLSearchParams();
    Array.from(filteredParams.keys())
      .sort()
      .forEach((key) => {
        sortedParams.set(key, filteredParams.get(key));
      });

    const normalizedUrl =
      u.origin +
      normalizedPathname +
      (sortedParams.toString() ? "?" + sortedParams.toString() : "");

    return normalizedUrl.toLowerCase();
  } catch (error) {
    console.warn("URL normalization failed:", error);
    return url.trim().toLowerCase();
  }
}

async function getLinkedInSessionId() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["user_info"], (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      const userInfo = result.user_info;
      if (!userInfo) {
        return reject("user_info not found");
      }
      if (!window.__mp_logged_id) {
        console.log("LinkedIn ID:", userInfo);
        window.__mp_logged_id = true;
      }
      resolve(userInfo);
    });
  });
}

// Enhanced wait for filters bar with better selectors
async function waitForFiltersBar(maxRetries = 20, retryDelay = 500) {
  for (let i = 0; i < maxRetries; i++) {
    // Try multiple selectors for the filters bar
    const selectors = [
      "#search-reusables__filters-bar ul",
      "#search-reusables__filters-bar",
      ".search-reusables__filter-list",
      ".search-results-container .artdeco-pill-choice-group",
      "[data-view-name='search-results'] .artdeco-pill-choice-group",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        // For the filters bar, we want the ul element specifically
        if (selector.includes("ul")) {
          console.log(
            `Filters bar UL found on attempt ${
              i + 1
            } with selector: ${selector}`
          );
          return element;
        } else {
          // If we found the container, look for ul inside
          const ul = element.querySelector("ul") || element;
          if (ul) {
            console.log(
              `Filters bar found on attempt ${i + 1} with selector: ${selector}`
            );
            return ul;
          }
        }
      }
    }

    if (i < maxRetries - 1) {
      console.log(`Retry ${i + 1}/${maxRetries} waiting for filters bar`);
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }

  throw new Error(`Filters bar not found after ${maxRetries} retries`);
}

// Inject drawer styles
function injectDrawerStyles() {
  if (document.getElementById("mp-topic-drawer-style")) return;
  const style = document.createElement("style");
  style.id = "mp-topic-drawer-style";
  style.textContent = `
    .mp-topic-drawer-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.30); z-index: 99998; transition: opacity 0.3s;
    }
    .mp-topic-drawer {
      position: fixed; top: 0; right: 0; width: 460px; height: 100vh; background: #fff;
      box-shadow: rgba(0,0,0,0.1) -2px 0px 5px; z-index: 99999;
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .mp-drawer-open { transform: translateX(0); }
    .mp-drawer-closed { transform: translateX(100%); }
    .mp-topic-drawer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 15px; border-bottom: 1px solid #e5e7eb;
      position: relative;
    }
    .mp-topic-drawer-logo-title { display: flex; align-items: center; gap: 6px; }
    .mp-topic-drawer-logo { width: 36px; height: 36px; border-radius: 6px; }
    .mp-topic-drawer-title { font-size: 2rem; font-weight: 700; color: #22223b; letter-spacing: -0.5px; }
    .mp-topic-drawer-subtitle { font-size: 1.4rem; color: #666; margin-top: 2px; }
    .mp-topic-drawer-close {
      background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px;
      position: absolute; top: 12px; right: 12px; z-index: 2;
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    .mp-topic-drawer-close:hover { background: #f3f4f6; }
    .mp-topic-drawer-close svg { width: 22px; height: 22px; color: #222; }
    .mp-topic-drawer-main {
      flex: 1; overflow-y: auto; padding:0px 15px; display: flex; flex-direction: column; gap: 4px;
    }
    .mp-topic-drawer-section { margin-bottom: 8px; }
    .mp-topic-drawer-label { 
      font-size: 14px; font-weight: 600; color: #333; margin-top: 6px; margin-bottom: 2px; display: block;
    }
    .mp-topic-drawer-sublabel {
      font-size: 12px; color: #666; margin-bottom: 5px; display: block; line-height: 1.4;
    }
    .mp-topic-drawer-select {
      width: 100%; padding:5px 10px; border: 1px solid #ddd; border-radius: 6px;
      font-size: 14px; color: #333; background: #fff;
      margin-bottom: 10px;
    }
    .mp-topic-drawer-textarea {
      width: 100%; padding: 8px;
      border: 1px solid #ddd; border-radius: 6px;
      font-size: 14px; line-height: 1.5;
      resize: vertical;
      margin-bottom: 10px;
    }
    .mp-topic-drawer-textarea.large {
      min-height: 180px;
    }
    .mp-topic-drawer-textarea.medium {
      min-height: 120px;
    }
    .mp-topic-drawer-textarea.small {
      min-height: 90px;
    }
    .mp-topic-drawer-footer {
      padding: 12px 24px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
      background: #fff;
      justify-content: flex-end;
    }
    .mp-topic-drawer-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      min-width: 100px;
      transition: all 0.2s;
    }
    .mp-topic-drawer-btn-primary {
      background: #000;
      color: #fff;
      border: none;
    }
    .mp-topic-drawer-btn-primary:hover {
      background: #333;
    }
    .mp-topic-drawer-btn-secondary {
      background: #fff;
      color: #333;
      border: 1px solid #ddd;
    }
    .mp-topic-drawer-btn-secondary:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }
  `;
  document.head.appendChild(style);
}

// Show drawer to add topic prompt and workspace
async function showAddTopicPopover(buttonEl, handleAddTopicToList) {
  injectDrawerStyles();
  let drawerEl = document.querySelector(".mp-topic-drawer");
  if (drawerEl) drawerEl.remove();

  const hasToken = await checkAuthToken();
  if (!hasToken) {
    console.log("No auth token found, showing login UI");

    // Create login drawer
    injectDrawerStyles();
    
    // Remove any existing drawer
    const existingDrawer = document.querySelector(".mp-topic-drawer");
    const existingOverlay = document.querySelector(".mp-topic-drawer-overlay");
    if (existingDrawer) existingDrawer.remove();
    if (existingOverlay) existingOverlay.remove();
    
    // Create drawer
    const drawer = document.createElement("div");
    drawer.className = "mp-topic-drawer mp-drawer-closed";

    // Create overlay with opacity 0
    const overlayDiv = document.createElement("div");
    overlayDiv.className = "mp-topic-drawer-overlay";
    overlayDiv.style.opacity = "0";
    overlayDiv.onclick = closeDrawer;

    // Header
    const header = document.createElement("div");
    header.className = "mp-topic-drawer-header";

    // Logo and title
    const logoTitle = document.createElement("div");
    logoTitle.className = "mp-topic-drawer-logo-title";
    const headerLogo = document.createElement("img");
    headerLogo.src = chrome.runtime.getURL("assets/logo_48.png");
    headerLogo.alt = "ManagePlus Logo";
    headerLogo.className = "mp-topic-drawer-logo";
    const title = document.createElement("div");
    title.innerHTML = `
      <div class="mp-topic-drawer-title">Login Required</div>
    `;
    logoTitle.appendChild(headerLogo);
    logoTitle.appendChild(title);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "mp-topic-drawer-close";
    closeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L14 14M14 6L6 14" stroke="#222" stroke-width="2" stroke-linecap="round"/></svg>`;
    closeBtn.onclick = closeDrawer;

    header.appendChild(logoTitle);
    header.appendChild(closeBtn);
    drawer.appendChild(header);

    // Create login UI
    const loginContainer = document.createElement("div");
    loginContainer.className = "mp-topic-drawer-main";

    const contentDiv = document.createElement("div");
    contentDiv.style.cssText = "text-align: center; padding: 40px 20px;";

    // Logo
    const logo = document.createElement("img");
    logo.src = "https://app.manageplus.io/admin/images/mp_logo_transparent.png";
    logo.alt = "ManagePlus Logo";
    logo.style.cssText = `
      width: 80px;
      height: 80px;
      display: block;
      margin: 0 auto 24px auto;
      border-radius: 12px;
    `;

    // Description
    const description = document.createElement("p");
    description.textContent = "To add topic you need to login to your ManagePlus account";
    description.style.cssText = `
      font-size: 15px;
      color: #6B7280;
      text-align: center;
      margin-bottom: 24px;
      line-height: 1.5;
      padding: 0 20px;
    `;

    // Login button container
    const loginButtonContainer = document.createElement("div");
    loginButtonContainer.style.cssText = `
      display: flex;
      justify-content: center;
      padding: 0 20px;
    `;

    // Login button
    const loginBtn = document.createElement("button");
    loginBtn.className = "mp-topic-drawer-btn mp-topic-drawer-btn-primary";
    loginBtn.style.minWidth = "200px";
    loginBtn.textContent = "Login to ManagePlus";

    // Login button click handler
    loginBtn.onclick = () => {
      window.open("https://app.manageplus.io/", "_blank");
      closeDrawer();
    };

    // Append elements
    loginButtonContainer.appendChild(loginBtn);
    
    contentDiv.appendChild(logo);
    contentDiv.appendChild(description);
    contentDiv.appendChild(loginButtonContainer);
    loginContainer.appendChild(contentDiv);
    drawer.appendChild(loginContainer);

    // Add overlay and drawer to document
    document.body.appendChild(overlayDiv);
    document.body.appendChild(drawer);

    // Define close function
    function closeDrawer() {
        drawer.classList.remove("mp-drawer-open");
        drawer.classList.add("mp-drawer-closed");
        overlayDiv.style.opacity = "0";
        setTimeout(() => {
            drawer.remove();
            overlayDiv.remove();
        }, 300);
    }

    // Animate drawer in after a short delay
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            drawer.classList.remove("mp-drawer-closed");
            drawer.classList.add("mp-drawer-open");
            overlayDiv.style.opacity = "1";
        });
    });

    return;
  }

  const workspaceList = await fetchWorkspaces();
  const { DEFAULT_SETTINGS } = require("../../utils/constant");
  const defaultPrompt = DEFAULT_SETTINGS.userPrompt
    ?.split("\n")
    .map((line) => line.trimStart())
    .join("\n");

  // Extract keywords from current URL
  const currentUrl = new URL(window.location.href);
  const keywords = currentUrl.searchParams.get("keywords") || "";
  const defaultListName = keywords
    ? `Linkedin-${keywords}`
    : "Linkedin-default";

  // Create drawer
  const drawer = document.createElement("div");
  drawer.className = "mp-topic-drawer mp-drawer-closed";

  // Create overlay
  const overlayDiv = document.createElement("div");
  overlayDiv.className = "mp-topic-drawer-overlay";
  overlayDiv.onclick = closeDrawer;

  // Header
  const header = document.createElement("div");
  header.className = "mp-topic-drawer-header";

  // Logo and title
  const logoTitle = document.createElement("div");
  logoTitle.className = "mp-topic-drawer-logo-title";
  const logo = document.createElement("img");
  logo.src = chrome.runtime.getURL("assets/logo_48.png");
  logo.alt = "ManagePlus Logo";
  logo.className = "mp-topic-drawer-logo";
  const title = document.createElement("div");
  title.innerHTML = `
    <div class="mp-topic-drawer-title">Add New Topic</div>
    <div class="mp-topic-drawer-subtitle">Add your topic to do engagement with this topic</div>
  `;
  logoTitle.appendChild(logo);
  logoTitle.appendChild(title);

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "mp-topic-drawer-close";
  closeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L14 14M14 6L6 14" stroke="#222" stroke-width="2" stroke-linecap="round"/></svg>`;
  closeBtn.onclick = closeDrawer;

  header.appendChild(logoTitle);
  header.appendChild(closeBtn);
  drawer.appendChild(header);

  // Main content
  const main = document.createElement("div");
  main.className = "mp-topic-drawer-main";

  // 1. Workspace Selection
  const workspaceLabel = document.createElement("label");
  workspaceLabel.textContent = "Select Workspace";
  workspaceLabel.className = "mp-topic-drawer-label";

  const workspaceSelect = document.createElement("select");
  workspaceSelect.className = "mp-topic-drawer-select";
  populateBoards(workspaceSelect, workspaceList);

  // 2. Contact Type Selection
  const contactTypeLabel = document.createElement("label");
  contactTypeLabel.textContent = "Select List";
  contactTypeLabel.className = "mp-topic-drawer-label";
  const contactTypeSubLabel = document.createElement("span");
  contactTypeSubLabel.className = "mp-topic-drawer-sublabel";
  contactTypeSubLabel.textContent =
    "Select a list to save the engaged users in CRM for better organization and tracking";

  const contactTypeSelect = document.createElement("select");
  contactTypeSelect.className = "mp-topic-drawer-select";

  // Add default option
  const defaultOption = document.createElement("option");
  defaultOption.value = "default";
  defaultOption.textContent = defaultListName;
  defaultOption.selected = true;
  contactTypeSelect.appendChild(defaultOption);

  // Function to populate contact types
  async function populateContactTypes(businessId) {
    if (!businessId) return;

    contactTypeSelect.innerHTML = "";
    contactTypeSelect.appendChild(defaultOption);

    try {
      const contactTypes = await fetchContactTypes(businessId);
      contactTypes.forEach((type) => {
        const option = document.createElement("option");
        option.value = type._id;
        option.textContent = type.name;
        contactTypeSelect.appendChild(option);
      });
    } catch (error) {
      console.error("Failed to fetch contact types:", error);
    }
  }

  // Populate contact types when workspace changes
  workspaceSelect.addEventListener("change", () => {
    const selectedWorkspace = workspaceSelect.value;
    populateContactTypes(selectedWorkspace);
  });

  // Initial population if workspace is already selected
  if (workspaceSelect.value) {
    populateContactTypes(workspaceSelect.value);
  }

  // 3. Business Goal Field
  const businessGoalLabel = document.createElement("label");
  businessGoalLabel.textContent = "Business Goal Prompt*";
  businessGoalLabel.className = "mp-topic-drawer-label";
  const businessGoalSubLabel = document.createElement("span");
  businessGoalSubLabel.className = "mp-topic-drawer-sublabel";
  businessGoalSubLabel.textContent =
    "Your Business Goal Prompt: This prompt helps AI analyze posts before engagement. Only posts that match your business goal will be engaged with, ensuring targeted and relevant interactions.";

  const businessGoalTextarea = document.createElement("textarea");
  businessGoalTextarea.className = "mp-topic-drawer-textarea small";
  businessGoalTextarea.placeholder =
    "Example: find only people who is hiring email marketer";
  businessGoalTextarea.rows = 3;

  // 3.5 Engagement Type Section
  const engagementTypeLabel = document.createElement("label");
  engagementTypeLabel.textContent = "Engagement Type";
  engagementTypeLabel.className = "mp-topic-drawer-label";
  const engagementTypeSubLabel = document.createElement("span");
  engagementTypeSubLabel.className = "mp-topic-drawer-sublabel";
  engagementTypeSubLabel.textContent =
    "Choose engagement types you want to perform with this topic";

  // Create checkbox container with flex layout
  const checkboxContainer = document.createElement("div");
  checkboxContainer.style.cssText = `
    display: flex;
    gap: 24px;
    margin-bottom: 10px;
  `;

  // Function to create a checkbox with label
  function createCheckbox(id, text) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      display: flex;
    
      gap: 8px;
    `;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.checked = true; // Default checked
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      margin: 0;
      cursor: pointer;
    `;

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = text;
    label.style.cssText = `
      font-size: 14px;
      color: #374151;
      cursor: pointer;
      user-select: none;
    `;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    return wrapper;
  }

  // Create checkboxes
  const likeCheckbox = createCheckbox("engagementLike", "Like");
  const commentCheckbox = createCheckbox("engagementComment", "Comment");
  const connectCheckbox = createCheckbox("engagementConnect", "Connect");
  
  // Add checkboxes to container in correct sequence
  checkboxContainer.appendChild(likeCheckbox);
  checkboxContainer.appendChild(commentCheckbox);
  checkboxContainer.appendChild(connectCheckbox);

  // 4. Comment Engagement Prompt Field
  const promptLabel = document.createElement("label");
  promptLabel.textContent = "Comment Engagement Prompt *";
  promptLabel.className = "mp-topic-drawer-label";
  const promptSubLabel = document.createElement("span");
  promptSubLabel.className = "mp-topic-drawer-sublabel";
  promptSubLabel.textContent =
    "This is the engagement prompt that AI will use to generate comments on posts. Make it specific to get relevant responses.";

  const promptTextarea = document.createElement("textarea");
  promptTextarea.className = "mp-topic-drawer-textarea large";
  promptTextarea.value = defaultPrompt || "";
  promptTextarea.rows = 7;

  // 5. Profile Connection Prompt Field
  const profilePromptLabel = document.createElement("label");
  profilePromptLabel.textContent = "Profile Connection Request Prompt (Optional)";
  profilePromptLabel.className = "mp-topic-drawer-label";
  const profilePromptSubLabel = document.createElement("span");
  profilePromptSubLabel.className = "mp-topic-drawer-sublabel";
  profilePromptSubLabel.textContent =
    "Smart Connection Filtering: AI will analyze user profiles (name, job title, about section) before sending connection requests. If criteria match, connection is sent. If empty, all connections are sent without filtering.";

  const profilePromptTextarea = document.createElement("textarea");
  profilePromptTextarea.className = "mp-topic-drawer-textarea medium";
  profilePromptTextarea.placeholder =
    "Example: Connect with professionals in digital marketing who have experience in email marketing or are looking to hire email marketers";
  profilePromptTextarea.rows = 5;

  // Footer with buttons
  const footer = document.createElement("div");
  footer.className = "mp-topic-drawer-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "mp-topic-drawer-btn mp-topic-drawer-btn-secondary";
  cancelBtn.onclick = closeDrawer;

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "mp-topic-drawer-btn mp-topic-drawer-btn-primary";

    // Save button click handler
    saveBtn.onclick = async () => {
      const selectedWorkspace = workspaceSelect.value;
      const selectedContactType = contactTypeSelect.value;
      const businessGoal = businessGoalTextarea.value.trim();
      const promptValue = promptTextarea.value.trim() || defaultPrompt || "";
      const profilePrompt = profilePromptTextarea.value.trim();
      
      // Get engagement type values
      const like = document.getElementById("engagementLike").checked;
      const comment = document.getElementById("engagementComment").checked;
      const connect = document.getElementById("engagementConnect").checked;

      // Validation - all fields required
      if (!selectedWorkspace) {
        showNotification("Please select a workspace", "error");
        return;
      }
      if (!businessGoal) {
        showNotification("Business Goal is required", "error");
        return;
      }
      if (!promptValue) {
        showNotification("Comment Engagement Prompt is required", "error");
        return;
      }
      if (!like && !comment && !connect) {
        showNotification("Please select at least one engagement type", "error");
        return;
      }
      // Profile prompt is optional, no validation needed
      
      try {
      // Disable save button while processing
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      let contactTypeId = selectedContactType;

      // If default option is selected, create new contact type
      if (selectedContactType === "default") {
        const newContactType = await createContactType(
          selectedWorkspace,
          defaultListName
        );
        contactTypeId = newContactType._id;
      }

      // Save to chrome storage
      chrome.storage.local.set(
        {
          selected_workspace: selectedWorkspace,
          topic_prompt: promptValue,
          profile_prompt: profilePrompt,
        },
        async () => {
          await handleAddTopicToList(
            selectedWorkspace,
            promptValue,
            businessGoal,
            contactTypeId,
            profilePrompt,
            like,
            comment,
            connect
          );
          closeDrawer();
        }
      )
    } catch (error) {
      console.error("Error saving topic:", error);
      showNotification("Failed to save topic", "error");
    } finally {
      // Re-enable save button
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  };

  // Append all elements to main
  main.appendChild(workspaceLabel);

  main.appendChild(workspaceSelect);

  main.appendChild(contactTypeLabel);
  main.appendChild(contactTypeSubLabel);
  main.appendChild(contactTypeSelect);

  main.appendChild(businessGoalLabel);
  main.appendChild(businessGoalSubLabel);
  main.appendChild(businessGoalTextarea);

  main.appendChild(engagementTypeLabel);
  main.appendChild(engagementTypeSubLabel);
  main.appendChild(checkboxContainer);

  main.appendChild(promptLabel);
  main.appendChild(promptSubLabel);
  main.appendChild(promptTextarea);

  main.appendChild(profilePromptLabel);
  main.appendChild(profilePromptSubLabel);
  main.appendChild(profilePromptTextarea);

  // Append footer with buttons
  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);

  // Construct drawer
  drawer.appendChild(main);
  drawer.appendChild(footer);

  // Add overlay and drawer to document
  document.body.appendChild(overlayDiv);
  document.body.appendChild(drawer);

  // Animate drawer in
  setTimeout(() => {
    drawer.classList.remove("mp-drawer-closed");
    drawer.classList.add("mp-drawer-open");
    overlayDiv.style.opacity = "1";
  }, 10);

  // Close drawer function
  function closeDrawer() {
    drawer.classList.remove("mp-drawer-open");
    drawer.classList.add("mp-drawer-closed");
    overlayDiv.style.opacity = "0";
    setTimeout(() => {
      drawer.remove();
      overlayDiv.remove();
    }, 300);
  }
}

// Remove any existing topic button in the filters bar
function cleanupTopicButton() {
  const selectors = [
    "#search-reusables__filters-bar ul li.mp-topic-button-li",
    ".search-reusables__filter-list li.mp-topic-button-li",
    ".mp-topic-button-li",
  ];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((li) => li.remove());
  });
}

// Check if button needs to be updated
function shouldUpdateButton(newState) {
  if (!currentButtonState) return true;

  const existingButton = document.querySelector(".mp-topic-button");
  if (!existingButton) return true;

  return (
    currentButtonState.isManaged !== newState.isManaged ||
    currentButtonState.url !== newState.url
  );
}

// Render the topic button with styling and click handlers
async function renderTopicButton({ isManaged, onAdd, onManage }) {
  try {
    const ul = await waitForFiltersBar();

    // Check if user has auth token first

    // Check if we need to update the button
    const newState = {
      isManaged,
      url: window.location.href,
    };

    if (!shouldUpdateButton(newState)) {
      console.log("Button already in correct state, skipping render");
      return;
    }

    // Temporarily disconnect observer to prevent infinite loop
    observer.disconnect();

    // Remove existing button before adding
    cleanupTopicButton();

    const li = document.createElement("li");
    li.className = "mp-topic-button-li";

    const button = document.createElement("button");
    button.className = "mp-topic-button";
    button.type = "button";
    button.innerText = isManaged ? "Manage Topic List" : "Add Topic to List";

    // Button styling
    const baseStyle = `
      background-color: #000000;
      color: #ffffff;
      border: 1px solid #333333;
      border-radius: 1.59rem;
      font-size: 1.6rem;
      padding: 0.4rem 1.2rem;
      height: 32px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
      margin: 0 4px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    `;

    button.style.cssText = baseStyle;

    button.addEventListener("mouseenter", () => {
      button.style.backgroundColor = "#333333";
      button.style.transform = "translateY(-1px)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.backgroundColor = "#000000";
      button.style.transform = "translateY(0)";
    });

    button.addEventListener("mousedown", () => {
      button.style.transform = "translateY(0)";
    });

    button.onclick = isManaged ? onManage : onAdd;

    li.appendChild(button);
    ul.appendChild(li);

    // Update current state
    currentButtonState = newState;
    console.log("Button rendered successfully with state:", newState);

    // Reconnect observer after a short delay
    setTimeout(() => {
      startObservingDom();
    }, 100);
  } catch (error) {
    console.error("Failed to render topic button:", error);
    // Reconnect observer even if render fails
    setTimeout(() => {
      startObservingDom();
    }, 100);
  }
}

async function isCurrentPageManagedTopic() {
  try {
    const sessionId = await getLinkedInSessionId();
    if (!sessionId) return { isManaged: false, topicId: null };

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "getTopicList", sessionId },
        (response) => {
          if (
            response &&
            response.success &&
            Array.isArray(response.data?.data?.rows)
          ) {
            const currentUrlNorm = normalizeUrl(window.location.href);
            console.log("Current URL normalized:", currentUrlNorm);
            console.log(
              "Checking against stored topics:",
              response.data.data.rows.length,
              "topics"
            );

            let managedTopic = null;

            const isManaged = response.data.data.rows.some((topic) => {
              const topicUrlNorm = normalizeUrl(topic.url);
              const isSameUser =
                String(topic.lkdn_profile_id) === String(sessionId);

              console.log(`Comparing:
                Topic URL: ${topicUrlNorm}
                Current URL: ${currentUrlNorm}
                URLs match: ${topicUrlNorm === currentUrlNorm}
                User match: ${isSameUser} (${
                topic.lkdn_profile_id
              } === ${sessionId})`);

              const isMatch = topicUrlNorm === currentUrlNorm && isSameUser;
              if (isMatch) {
                managedTopic = topic;
              }
              return isMatch;
            });

            console.log("Final result - isManaged:", isManaged);

            if (isManaged && managedTopic) {
              chrome.storage.local.set(
                {
                  selected_workspace: managedTopic?.business_id,
                  topic_prompt: managedTopic?.prompt,
                },
                () => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "Chrome storage error:",
                      chrome.runtime.lastError
                    );
                  } else {
                    console.log(
                      "✅ Workspace and topic prompt saved successfully"
                    );
                  }
                }
              );

              resolve({
                isManaged: true,
              });
            } else {
              resolve({ isManaged: false, topicId: null });
            }
          } else {
            console.log("No valid topic list response");
            resolve({ isManaged: false, topicId: null });
          }
        }
      );
    });
  } catch (error) {
    console.error("Error checking managed topic:", error);
    return { isManaged: false, topicId: null };
  }
}

// Click handler for adding topic
async function handleAddButton(e) {
  const targetButton = e.currentTarget;
  showAddTopicPopover(targetButton, handleAddTopicToList);
}

function handleManageButton() {
  console.log("Manage button clicked");

  chrome.runtime.sendMessage({ action: "OPEN_OPTIONS_PAGE" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Chrome runtime error:", chrome.runtime.lastError);
      openOptionsPageFallback();
      return;
    }

    if (response && response.success) {
      console.log("Options page opened successfully");
    } else {
      console.log("Failed to open options page, trying fallback");
      openOptionsPageFallback();
    }
  });
}

// Fallback function to open options page
function openOptionsPageFallback() {
  try {
    const extensionId = chrome.runtime.id;
    const optionsUrl = chrome.runtime.getURL("options.html");
    window.open(optionsUrl, "_blank");
  } catch (error) {
    console.error("Fallback failed:", error);
    showNotification(
      "Please open extension options from the extension popup menu",
      "info"
    );
  }
}

// Add current page as a topic to the list in background
async function handleAddTopicToList(
  selectedWorkspace,
  promptValue,
  businessGoal,
  contactTypeId,
  profilePrompt,
  like,
  comment,
  connect
) {
  try {
    const sessionId = await getLinkedInSessionId();
    if (!sessionId) {
      showNotification("Failed to get LinkedIn session ID", "error");
      return;
    }

    // Use default prompt if no prompt provided
    if (!promptValue || promptValue.trim() === "") {
      const { DEFAULT_SETTINGS } = require("../../utils/constant");
      promptValue =
        DEFAULT_SETTINGS.userPrompt
          ?.split("\n")
          .map((line) => line.trimStart())
          .join("\n") || "";
    }

    const currentUrl = window.location.href;
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "ADD_TOPIC_TO_LIST_BG",
          url: currentUrl,
          sessionId,
          promptValue,
          businessId: selectedWorkspace,
          businessGoal: businessGoal,
          contactTypeId: contactTypeId,
          profilePrompt: profilePrompt,
          engagementTypes: {
            like,
            comment,
            connect
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve(response.data);
            currentButtonState = null;
            setTimeout(() => {
              debounceRenderButton();
            }, 500);
          } else {
            reject(new Error(response?.error || "Failed to add topic"));
          }
        }
      );
    });
    showNotification("Topic added to list successfully", "success");
    chrome.runtime.sendMessage({ action: "refreshTopicList" });
  } catch (error) {
    console.error("Error adding topic:", error);
    showNotification("Failed to add topic to list", "error");
  }
}

let lastURL = window.location.href;
let renderTimeout = null;

// Debounced render with timeout cleanup
function debounceRenderButton() {
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }

  renderTimeout = setTimeout(async () => {
    if (renderInProgress) {
      console.log("Render already in progress, skipping");
      return;
    }

    renderInProgress = true;
    try {
      await renderButtonIfNeeded();
    } catch (err) {
      console.error("Error rendering topic button:", err);
    } finally {
      renderInProgress = false;
      renderTimeout = null;
    }
  }, 300);
}

// Main function that decides whether to render or cleanup the button based on current URL
async function renderButtonIfNeeded() {
  const currentUrl = window.location.href;
  const pathname = window.location.pathname;

  console.log("=== renderButtonIfNeeded called ===");
  console.log("Current URL:", currentUrl);
  console.log("Pathname:", pathname);
  console.log("Last URL:", lastURL);

  // Button only on /search/results/content and subpaths
  if (!/^\/search\/results\/content(\/|$)/.test(pathname)) {
    console.log("Not on content search page, cleaning up button");
    observer.disconnect();
    cleanupTopicButton();
    currentButtonState = null;
    lastURL = currentUrl;
    console.log("Button removed (not on /search/results/content)");
    setTimeout(() => {
      startObservingDom();
    }, 100);
    return;
  }

  console.log("On content search page, proceeding with button logic");

  // Always re-check managed status on URL change or when forced
  if (lastURL !== currentUrl || !currentButtonState) {
    console.log("URL changed or no current state, re-checking managed status");
    currentButtonState = null;
  }

  try {
    // Always check for managed status on content pages
    console.log("Checking if current page is managed topic...");
    const { isManaged } = await isCurrentPageManagedTopic();
    console.log("isManaged result:", isManaged);

    console.log("Rendering button with isManaged =", isManaged);
    await renderTopicButton({
      isManaged,
      onAdd: handleAddButton,
      onManage: handleManageButton,
    });

    lastURL = currentUrl;
  } catch (error) {
    console.error("Error in renderButtonIfNeeded:", error);
  }
}

// Enhanced navigation detection for LinkedIn SPA
function patchHistoryMethods() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  // Override pushState
  history.pushState = function (...args) {
    const result = originalPushState.apply(history, args);
    console.log("pushState detected:", args[2] || window.location.href);
    setTimeout(() => onNavigationChange(), 150);
    return result;
  };

  // Override replaceState
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(history, args);
    console.log("replaceState detected:", args[2] || window.location.href);
    setTimeout(() => onNavigationChange(), 150);
    return result;
  };

  // Handle popstate (back/forward buttons)
  window.addEventListener("popstate", (event) => {
    console.log("popstate detected:", window.location.href);
    setTimeout(() => onNavigationChange(), 150);
  });

  // Additional URL change detection using polling (fallback)
  let currentUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      console.log("URL change detected via polling:", window.location.href);
      currentUrl = window.location.href;
      onNavigationChange();
    }
  }, 1000);
}

// Called on navigation events with enhanced logging
function onNavigationChange() {
  const newUrl = window.location.href;
  const pathname = window.location.pathname;

  console.log("=== Navigation Change Detected ===");
  console.log("New URL:", newUrl);
  console.log("Pathname:", pathname);
  console.log(
    "Is content search page:",
    /^\/search\/results\/content(\/|$)/.test(pathname)
  );

  // Always reset state on navigation
  currentButtonState = null;
  lastURL = newUrl;

  // Clear any existing render timeout
  if (renderTimeout) {
    clearTimeout(renderTimeout);
    renderTimeout = null;
  }

  // Trigger button render/cleanup
  debounceRenderButton();
}

// Enhanced observer for better SPA detection with more comprehensive monitoring
const observer = new MutationObserver((mutations) => {
  // Ignore mutations caused by our own button
  const isOurMutation = mutations.some((mutation) => {
    return (
      Array.from(mutation.addedNodes).some(
        (node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.classList?.contains("mp-topic-button-li") ||
            node.querySelector?.(".mp-topic-button-li"))
      ) ||
      Array.from(mutation.removedNodes).some(
        (node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.classList?.contains("mp-topic-button-li") ||
            node.querySelector?.(".mp-topic-button-li"))
      )
    );
  });

  if (isOurMutation) {
    console.log("Ignoring mutation caused by our button");
    return;
  }

  // Check for URL changes (SPA navigation) - this catches cases where history methods don't fire
  const currentUrl = window.location.href;
  if (lastURL !== currentUrl) {
    console.log("URL change detected via observer:", currentUrl);
    onNavigationChange();
    return;
  }

  // Look for key LinkedIn SPA navigation indicators
  const hasNavigationChanges = mutations.some((mutation) => {
    // Check for main content area changes
    if (
      mutation.target.classList?.contains("scaffold-layout__main") ||
      mutation.target.classList?.contains("application-outlet") ||
      mutation.target.id === "main"
    ) {
      return true;
    }

    // Check for search results container changes
    if (
      mutation.target.classList?.contains("search-results-container") ||
      mutation.target.querySelector(".search-results-container")
    ) {
      return true;
    }

    // Check for filters bar or search navigation changes
    if (
      mutation.target.id === "search-reusables__filters-bar" ||
      mutation.target.closest("#search-reusables__filters-bar") ||
      mutation.target.classList?.contains("search-reusables__side-panel") ||
      Array.from(mutation.addedNodes).some(
        (node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.id === "search-reusables__filters-bar" ||
            node.querySelector("#search-reusables__filters-bar") ||
            node.classList?.contains("search-results-container"))
      )
    ) {
      return true;
    }

    return false;
  });

  if (hasNavigationChanges) {
    console.log("LinkedIn SPA navigation change detected via DOM mutations");
    debounceRenderButton();
  }
});

function startObservingDom() {
  if (!isInitialized) return;

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    attributeOldValue: false,
  });
}

// Enhanced initialization with proper page ready checks
async function initializeScript() {
  console.log(`=== TOPIC BUTTON INITIALIZATION ===`);
  console.log(`Attempt: ${initializationAttempts + 1}`);
  console.log(`Current URL: ${window.location.href}`);
  console.log(`Pathname: ${window.location.pathname}`);

  try {
    // Always initialize the navigation detection regardless of current page
    console.log("Setting up navigation detection...");
    patchHistoryMethods();
    isInitialized = true;
    startObservingDom();

    // Check if we're currently on a content search page
    const pathname = window.location.pathname;
    const isContentSearchPage = /^\/search\/results\/content(\/|$)/.test(
      pathname
    );

    console.log("Is content search page:", isContentSearchPage);

    if (isContentSearchPage) {
      console.log("On content search page, waiting for page ready...");
      try {
        const pageReady = await waitForPageReady(10, 1000); // Reduced retries, increased delay

        if (pageReady) {
          console.log("Page ready, triggering initial render...");
          setTimeout(() => {
            debounceRenderButton();
          }, 800);
        } else {
          console.log("Page not ready, but will try to render anyway...");
          setTimeout(() => {
            debounceRenderButton();
          }, 1500);
        }
      } catch (error) {
        console.log("Page ready check failed, trying render anyway:", error);
        setTimeout(() => {
          debounceRenderButton();
        }, 1500);
      }
    } else {
      console.log(
        "Not on content search page, navigation detection is active for future navigations"
      );
    }

    console.log("✅ Topic button script initialized successfully");
  } catch (error) {
    console.error("❌ Error during initialization:", error);
    initializationAttempts++;

    if (initializationAttempts < MAX_INIT_ATTEMPTS) {
      setTimeout(() => {
        initializeScript();
      }, 3000); // Increased retry delay
    }
  }
}

// Immediate initialization with multiple triggers
console.log("=== SCRIPT LOADED ===");
console.log("Document ready state:", document.readyState);
console.log("Current URL:", window.location.href);

// Initialize immediately if DOM is ready, otherwise wait
if (document.readyState === "loading") {
  console.log("DOM still loading, waiting for DOMContentLoaded...");
  document.addEventListener("DOMContentLoaded", () => {
    console.log("DOMContentLoaded fired");
    initializeScript();
  });
} else {
  console.log("DOM already ready, initializing immediately");
  initializeScript();
}

// Additional fallback for LinkedIn's SPA navigation
window.addEventListener("load", () => {
  console.log("Window load event fired");
  if (!isInitialized) {
    console.log("Script not yet initialized, triggering from window load");
    initializeScript();
  }
});

// Global navigation listener for LinkedIn clicks with better targeting
document.addEventListener("click", (e) => {
  // More specific LinkedIn navigation detection
  const target = e.target.closest(
    `
    a[href*="/search/results"],
    .search-reusables__filter-pill,
    .artdeco-pill,
    .search-vertical-filter__filter-item,
    [data-control-name*="search"],
    .artdeco-tab,
    .search-navigation-panel__button
  `
      .replace(/\s+/g, "")
      .split(",")
      .join(",")
  );

  if (target) {
    const href = target.href || target.getAttribute("href");
    console.log("🔗 LinkedIn navigation click detected");
    console.log("Target element:", target.tagName, target.className);
    console.log("Href:", href);

    // Multiple delayed checks to catch the navigation
    setTimeout(() => checkForNavigation("immediate"), 200);
    setTimeout(() => checkForNavigation("delayed"), 800);
    setTimeout(() => checkForNavigation("final"), 1500);
  }
});

function checkForNavigation(checkType) {
  const newUrl = window.location.href;
  const pathname = window.location.pathname;

  console.log(`🔍 Navigation check (${checkType}):`, newUrl);

  if (newUrl !== lastURL) {
    console.log(`✅ URL changed detected via ${checkType} check`);
    console.log("Old URL:", lastURL);
    console.log("New URL:", newUrl);
    onNavigationChange();
  }
}

(async function () {
  let hasChecked = false;

  // Function to check if we're on the logged-in user's own profile
  function isOwnProfile() {
    // Method 1: Check for profile edit buttons that only appear on own profile
    const editButtons = [
      '[aria-label*="edit" i][aria-label*="profile" i]',
      '[data-control-name*="edit_profile"]',
      '.pv-s-profile-actions--edit',
      '.artdeco-button[aria-label*="Edit"]',
      '[data-view-name*="profile-edit"]'
    ];
    
    for (const selector of editButtons) {
      if (document.querySelector(selector)) {
        console.log("✅ Own profile detected via edit button:", selector);
        return true;
      }
    }

    // Method 2: Check URL patterns that indicate own profile
    const currentUrl = window.location.href;
    
    // Profile settings/edit pages
    if (currentUrl.includes('/public-profile/settings') || 
        currentUrl.includes('/me/profile-views') ||
        currentUrl.includes('/mypreferences') ||
        currentUrl.includes('/profile/edit')) {
      console.log("✅ Own profile detected via settings/edit URL");
      return true;
    }

    // Method 3: Look for "View profile" menu that typically appears on own profile
    const viewProfileElements = [
      '[data-control-name="view_profile"]',
      '[href*="/public-profile/settings"]',
      '.pv-s-profile-actions [href*="public-profile"]'
    ];
    
    for (const selector of viewProfileElements) {
      if (document.querySelector(selector)) {
        console.log("✅ Own profile detected via view profile element:", selector);
        return true;
      }
    }

    // Method 4: Check for profile visibility settings that only appear on own profile
    const profileSettingsIndicators = [
      '[data-control-name*="public_profile"]',
      '.pv-profile-section__see-more-inline',
      '.pv-profile-header__visibility-dropdown'
    ];

    for (const selector of profileSettingsIndicators) {
      if (document.querySelector(selector)) {
        console.log("✅ Own profile detected via settings indicator:", selector);
        return true;
      }
    }

    console.log("❌ Not on own profile - this appears to be someone else's profile");
    return false;
  }

  // Function to extract LinkedIn vanity name from DOM
  function extractLinkedInVanityName() {
    // Quick win: URL extraction
    const urlMatch = window.location.href.match(/\/in\/([^\/\?#]+)/);
    if (urlMatch) return urlMatch[1];

    // Search code tags with profile data
    const codeTags = document.querySelectorAll("code");

    for (let codeTag of codeTags) {
      const content = codeTag.textContent;

      // Skip empty or small content
      if (!content || content.length < 50) continue;

      // Look for LinkedIn profile indicators
      if (
        content.includes("publicIdentifier") &&
        (content.includes("MiniProfile") || content.includes("fs_miniProfile"))
      ) {
        try {
          const data = JSON.parse(content);

          // Method A: Check included array
          if (data.included && Array.isArray(data.included)) {
            for (let item of data.included) {
              if (
                item.publicIdentifier &&
                item.$type &&
                item.$type.includes("MiniProfile")
              ) {
                return item.publicIdentifier;
              }
            }
          }

          // Method B: Direct property check
          if (data.publicIdentifier) {
            return data.publicIdentifier;
          }
        } catch (parseError) {
          // Fallback: regex extraction
          const match = content.match(/"publicIdentifier":\s*"([^"]+)"/);
          if (match) return match[1];
        }
      }
    }

    return null;
  }

  // Check and update user_info only if we're on the logged-in user's own profile
  function checkAndUpdateUserInfo() {
    if (hasChecked) return; // Don't check again if already done

    // IMPORTANT: Only extract user info if we're on the logged-in user's own profile
    if (!isOwnProfile()) {
      console.log("🚫 Skipping user_info extraction - not on own profile");
      return;
    }

    const vanityName = extractLinkedInVanityName();
    if (!vanityName) return;

    console.log("🔍 Found vanity name on own profile:", vanityName);

    chrome.storage.local.get(["user_info"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Chrome storage error:", chrome.runtime.lastError);
        return;
      }

      // If user_info doesn't exist OR it doesn't match current vanityName, save/update it
      if (!result.user_info || result.user_info !== vanityName) {
        chrome.storage.local.set({ user_info: vanityName }, () => {
          if (!chrome.runtime.lastError) {
            if (!result.user_info) {
              console.log("✅ user_info saved (own profile):", vanityName);
            } else {
              console.log(
                "🔄 user_info updated from",
                result.user_info,
                "to",
                vanityName,
                "(own profile)"
              );
            }
            hasChecked = true; // Mark as checked so we don't do it again
          }
        });
      } else {
        console.log(
          "ℹ️ user_info already matches current profile:",
          result.user_info
        );
        hasChecked = true; // Mark as checked
      }
    });
  }

  // Initial check on load
  checkAndUpdateUserInfo();

  // Only observe if we haven't found and saved the info yet
  const observer = new MutationObserver(() => {
    if (!hasChecked) {
      checkAndUpdateUserInfo();
    } else {
      observer.disconnect(); // Stop observing once we've got the info
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
