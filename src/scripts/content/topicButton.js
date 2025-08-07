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

// Show popover to add topic prompt and workspace
async function showAddTopicPopover(buttonEl, handleAddTopicToList) {
  let popoverEl = document.querySelector(".mp-topic-popover");
  if (popoverEl) popoverEl.remove();

  const hasToken = await checkAuthToken();
  if (!hasToken) {
    console.log("No auth token found, showing login UI");

    // Create login popover
    popoverEl = document.createElement("div");
    popoverEl.className = "mp-topic-popover";
    Object.assign(popoverEl.style, {
      position: "absolute",
      zIndex: 9999,
      background: "#fff",
      border: "1px solid #ccc",
      borderRadius: "8px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
      padding: "0px",
      minWidth: "350px",
      maxWidth: "450px",
    });

    // Create login UI
    const loginContainer = document.createElement("div");
    loginContainer.className = "flex flex-col items-center justify-center py-0";

    const contentDiv = document.createElement("div");
    contentDiv.className = "bg-white p-4 max-w-md w-full text-center";
    Object.assign(contentDiv.style, {
      padding: "12px", // Increased padding
    });

    // Logo
    const logo = document.createElement("img");
    logo.src = "https://app.manageplus.io/admin/images/mp_logo_transparent.png";
    logo.alt = "ManagePlus Logo";
    logo.className = "mx-auto mb-0";
    Object.assign(logo.style, {
      width: "70px", // Slightly bigger logo
      height: "70px",
      display: "block",
      margin: "0 auto 16px auto", // More margin bottom
    });

    // Title
    const title = document.createElement("h3");
    title.textContent = "Login Required";
    Object.assign(title.style, {
      fontSize: "22px", // Bigger font
      fontWeight: "bold",
      color: "#111827",
      textAlign: "center",
      margin: "0 0 10px 0", // More spacing
      lineHeight: "1.2",
    });

    // Description
    const description = document.createElement("p");
    description.textContent =
      "To add topic you need to login to your ManagePlus account";
    Object.assign(description.style, {
      fontSize: "14px", // Bigger font
      color: "#6B7280",
      textAlign: "center",
      marginBottom: "14px", // More spacing
      lineHeight: "1.5",
      padding: "0 8px", // Side padding for better text flow
    });

    // Login button
    const loginContainerButton = document.createElement("div");
    loginContainerButton.style.display = "flex";
    loginContainerButton.style.justifyContent = "center";
    loginContainerButton.style.alignItems = "center";
    loginContainerButton.style.width = "100%";

    const loginBtn = document.createElement("button");
    // const loginBtn = document.createElement("button");
    loginBtn.id = "mp-login-btn";
    loginBtn.textContent = "Login to ManagePlus";
    Object.assign(loginBtn.style, {
      padding: "10px 12px", // More padding
      background: "#101112",
      color: "#fff",
      border: "none",
      boxShadow: "none",
      borderRadius: "8px", // Slightly more rounded
      fontWeight: "600",
      fontSize: "14px", // Bigger font
      outline: "none",
      transition: "background 0.2s",
      cursor: "pointer",
      width: "50%",
    });

    // Add hover effect
    loginBtn.addEventListener("mouseenter", () => {
      loginBtn.style.background = "#1f2937";
    });
    loginBtn.addEventListener("mouseleave", () => {
      loginBtn.style.background = "#101112";
    });

    // Login button click handler
    loginBtn.onclick = () => {
      // Open login page in new tab
      window.open("https://app.manageplus.io/", "_blank");
      popoverEl.remove();
    };

    // Append elements
    loginContainerButton.appendChild(loginBtn); // First append button to container

    contentDiv.appendChild(logo);
    contentDiv.appendChild(title);
    contentDiv.appendChild(description);
    contentDiv.appendChild(loginContainerButton); // Then append the container
    loginContainer.appendChild(contentDiv);
    popoverEl.appendChild(loginContainer);
    document.body.appendChild(popoverEl);

    // Position popover below the button
    const rect = buttonEl.getBoundingClientRect();
    popoverEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
    popoverEl.style.left = `${rect.left + window.scrollX}px`;

    // Close popover on outside click
    setTimeout(() => {
      function onClickOutside(e) {
        if (popoverEl && !popoverEl.contains(e.target)) {
          popoverEl.remove();
          document.removeEventListener("mousedown", onClickOutside);
        }
      }
      document.addEventListener("mousedown", onClickOutside);
    }, 0);

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

  popoverEl = document.createElement("div");
  popoverEl.className = "mp-topic-popover";
  Object.assign(popoverEl.style, {
    position: "absolute",
    zIndex: 9999,
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: "8px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
    padding: "12px",
    minWidth: "400px",
    overflowY: "auto",
  });

  // 1. Workspace Selection
  const workspaceLabel = document.createElement("label");
  workspaceLabel.textContent = "Select Workspace:";
  workspaceLabel.style.display = "block";
  workspaceLabel.style.marginBottom = "6px";
  workspaceLabel.style.fontWeight = "bold";

  const workspaceSelect = document.createElement("select");
  workspaceSelect.style.width = "100%";
  workspaceSelect.style.border = "1px solid #ccc";
  workspaceSelect.style.borderRadius = "4px";
  populateBoards(workspaceSelect, workspaceList);

  // 2. Contact Type Selection
  const contactTypeLabel = document.createElement("label");
  contactTypeLabel.textContent = "Select List:";
  contactTypeLabel.style.display = "block";
  contactTypeLabel.style.marginBottom = "6px";
  contactTypeLabel.style.fontWeight = "bold";

  const contactTypeSelect = document.createElement("select");
  contactTypeSelect.style.width = "100%";
  contactTypeSelect.style.border = "1px solid #ccc";
  contactTypeSelect.style.borderRadius = "4px";

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
  businessGoalLabel.textContent = "Business Goal: *";
  businessGoalLabel.style.display = "block";
  businessGoalLabel.style.marginBottom = "6px";
  businessGoalLabel.style.fontWeight = "bold";

  const businessGoalTextarea = document.createElement("textarea");
  businessGoalTextarea.style.width = "100%";
  businessGoalTextarea.style.height = "60px";
  businessGoalTextarea.style.padding = "8px";
  businessGoalTextarea.style.border = "1px solid #ccc";
  businessGoalTextarea.style.borderRadius = "4px";
  businessGoalTextarea.style.resize = "vertical";
  businessGoalTextarea.placeholder =
    "Example: find only people who is hiring email marketer";
  businessGoalTextarea.rows = 3;

  // 4. Comment Engagement Prompt Field
  const promptLabel = document.createElement("label");
  promptLabel.textContent = "Comment Engagement Prompt: *";
  promptLabel.style.display = "block";
  promptLabel.style.marginBottom = "6px";
  promptLabel.style.fontWeight = "bold";

  const promptTextarea = document.createElement("textarea");
  promptTextarea.style.width = "100%";
  promptTextarea.style.height = "120px";
  promptTextarea.style.padding = "8px";
  promptTextarea.style.marginBottom = "14px";
  promptTextarea.style.border = "1px solid #ccc";
  promptTextarea.style.borderRadius = "4px";
  promptTextarea.style.resize = "vertical";
  promptTextarea.value = defaultPrompt || "";

  // Save Button
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  Object.assign(saveBtn.style, {
    background: "#000000",
    color: "#fff",
    border: "none",
    borderRadius: "5px",
    padding: "8px 18px",
    fontWeight: "bold",
    cursor: "pointer",
    width: "100%",
  });

  // Save button click handler
  saveBtn.onclick = async () => {
    const selectedWorkspace = workspaceSelect.value;
    const selectedContactType = contactTypeSelect.value;
    const businessGoal = businessGoalTextarea.value.trim();
    const promptValue = promptTextarea.value.trim() || defaultPrompt || "";

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

    try {
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
        },
        async () => {
          await handleAddTopicToList(
            selectedWorkspace,
            promptValue,
            businessGoal,
            contactTypeId
          );
          popoverEl.remove();
        }
      );
    } catch (error) {
      console.error("Error saving topic:", error);
      showNotification("Failed to save topic", "error");
    }
  };

  // Append all elements
  popoverEl.appendChild(workspaceLabel);
  popoverEl.appendChild(workspaceSelect);
  popoverEl.appendChild(contactTypeLabel);
  popoverEl.appendChild(contactTypeSelect);
  popoverEl.appendChild(businessGoalLabel);
  popoverEl.appendChild(businessGoalTextarea);
  popoverEl.appendChild(promptLabel);
  popoverEl.appendChild(promptTextarea);
  popoverEl.appendChild(saveBtn);
  document.body.appendChild(popoverEl);

  // Position popover below the button
  const rect = buttonEl.getBoundingClientRect();
  popoverEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popoverEl.style.left = `${rect.left + window.scrollX}px`;

  // Close popover on outside click
  setTimeout(() => {
    function onClickOutside(e) {
      if (popoverEl && !popoverEl.contains(e.target)) {
        popoverEl.remove();
        document.removeEventListener("mousedown", onClickOutside);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
  }, 0);
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
  contactTypeId
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

  // Check and update user_info only if not already stored
  function checkAndUpdateUserInfo() {
    if (hasChecked) return; // Don't check again if already done

    const vanityName = extractLinkedInVanityName();
    if (!vanityName) return;

    console.log("🔍 Found vanity name:", vanityName);

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
              console.log("✅ user_info saved:", vanityName);
            } else {
              console.log(
                "🔄 user_info updated from",
                result.user_info,
                "to",
                vanityName
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
