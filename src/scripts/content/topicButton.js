// topicButton.js - Complete version with token check + infinite render fix

const { showNotification } = require("../../utils/notification");
const {
  populateBoards,
  updateLocalStorageObject,
} = require("../../utils/utils");

// Global state to track current button state
let currentButtonState = null;
let renderInProgress = false;
let isInitialized = false;

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
    // Keep the full URL but normalize case and remove trailing slash from pathname
    const normalizedPathname = u.pathname.replace(/\/+$/, "") || "/";

    // Get all query parameters except 'sid'
    const params = new URLSearchParams(u.search);
    const filteredParams = new URLSearchParams();

    // Add all parameters except 'sid'
    Array.from(params.keys()).forEach((key) => {
      if (key !== "sid") {
        filteredParams.set(key, params.get(key));
      }
    });

    // Sort remaining parameters for consistent comparison
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
      // Only log once:
      if (!window.__mp_logged_id) {
        console.log("LinkedIn ID:", userInfo);
        window.__mp_logged_id = true;
      }
      resolve(userInfo);
    });
  });
}

// Wait for a DOM element, retrying for resilience
async function waitForElementWithRetry(
  selector,
  maxRetries = 10,
  retryDelay = 1000
) {
  for (let i = 0; i < maxRetries; i++) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, retryDelay));
    console.log(`Retry ${i + 1}/${maxRetries} waiting for ${selector}`);
  }
  throw new Error(`Element ${selector} not found after ${maxRetries} retries`);
}

// Wait for filters bar with better retry logic
async function waitForFiltersBar(maxRetries = 15, retryDelay = 500) {
  for (let i = 0; i < maxRetries; i++) {
    const filtersBar = document.getElementById("search-reusables__filters-bar");
    const ul = filtersBar?.querySelector("ul");

    if (filtersBar && ul) {
      console.log(`Filters bar found on attempt ${i + 1}`);
      return ul;
    }

    if (i < maxRetries - 1) {
      console.log(`Retry ${i + 1}/${maxRetries} waiting for filters bar`);
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }

  throw new Error(`Filters bar not found after ${maxRetries} retries`);
}

// Show popover to add topic prompt and workspace
// Show popover to add topic prompt and workspace
async function showAddTopicPopover(buttonEl, handleAddTopicToList) {
  let popoverEl = document.querySelector(".mp-topic-popover");
  if (popoverEl) popoverEl.remove();

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

    // Clear existing options except default
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
          // business_goal: businessGoal,
          // contact_type_id: contactTypeId,
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
  const ul = document
    .getElementById("search-reusables__filters-bar")
    ?.querySelector("ul");
  if (ul) {
    ul.querySelectorAll("li.mp-topic-button-li").forEach((li) => li.remove());
  }
}

// Check if button needs to be updated
function shouldUpdateButton(newState) {
  if (!currentButtonState) return true;

  const existingButton = document.querySelector(".mp-topic-button");
  if (!existingButton) return true;

  return (
    currentButtonState.isManaged !== newState.isManaged ||
    currentButtonState.url !== newState.url ||
    currentButtonState.hasToken !== newState.hasToken
  );
}

// Render the topic button with styling and click handlers
async function renderTopicButton({ isManaged, onAdd, onManage }) {
  try {
    const ul = await waitForFiltersBar();

    // Check if user has auth token first
    const hasToken = await checkAuthToken();
    if (!hasToken) {
      console.log("No auth token found, skipping button render");
      // Clean up any existing button
      ul.querySelectorAll("li.mp-topic-button-li").forEach((li) => li.remove());
      currentButtonState = null;
      return;
    }

    // Check if we need to update the button
    const newState = {
      isManaged,
      url: window.location.href,
      hasToken,
    };

    if (!shouldUpdateButton(newState)) {
      console.log("Button already in correct state, skipping render");
      return;
    }

    // Temporarily disconnect observer to prevent infinite loop
    observer.disconnect();

    // Remove existing button before adding
    ul.querySelectorAll("li.mp-topic-button-li").forEach((li) => li.remove());

    const li = document.createElement("li");
    li.className = "mp-topic-button-li";

    const button = document.createElement("button");
    button.className = "mp-topic-button";
    button.type = "button";
    button.innerText = isManaged ? "Manage Topic List" : "Add Topic to List";

    // In the renderTopicButton function, replace the button styling section with:

    // FIX 3: Different styles based on managed status with updated CSS
    if (isManaged) {
      button.style.cssText = `
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

      button.addEventListener("mouseenter", () => {
        button.style.backgroundColor = "#333333";
        button.style.transform = "translateY(-1px)";
      });
      button.addEventListener("mouseleave", () => {
        button.style.backgroundColor = "#000000";
        button.style.transform = "translateY(0)";
      });
    } else {
      button.style.cssText = `
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

      button.addEventListener("mouseenter", () => {
        button.style.backgroundColor = "#333333";
        button.style.transform = "translateY(-1px)";
      });
      button.addEventListener("mouseleave", () => {
        button.style.backgroundColor = "#000000";
        button.style.transform = "translateY(0)";
      });
    }

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
              // Instead of updateLocalStorageObject calls, use chrome.storage.local.set
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

              // Update local storage with the topic ID
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
  // chrome.storage.local.get(
  //   ["selected_workspace", "topic_prompt"],
  //   async (result) => {
  //     if (result.selected_workspace) {
  //       // Use stored prompt or default
  //       const { DEFAULT_SETTINGS } = require("../../utils/constant");
  //       const defaultPrompt = DEFAULT_SETTINGS.userPrompt
  //         ?.split("\n")
  //         .map((line) => line.trimStart())
  //         .join("\n");
  //       const promptToUse = result.topic_prompt || defaultPrompt || "";

  //       await handleAddTopicToList(result.selected_workspace, promptToUse);
  //     } else {

  //     }
  //   }
  // );
}

function handleManageButton() {
  console.log("Manage button clicked");

  chrome.runtime.sendMessage({ action: "OPEN_OPTIONS_PAGE" }, (response) => {
    // Check if the runtime is still available
    if (chrome.runtime.lastError) {
      console.error("Chrome runtime error:", chrome.runtime.lastError);
      // Fallback: try to open options directly
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
            // Reset current state to force re-render
            currentButtonState = null;
            // Use longer delay after adding topic
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
  }, 300); // Reduced debounce time for better SPA responsiveness
}

// Main function that decides whether to render or cleanup the button based on current URL
async function renderButtonIfNeeded() {
  const currentUrl = window.location.href;
  const pathname = window.location.pathname;

  // Button only on /search/results/content and subpaths
  if (!/^\/search\/results\/content(\/|$)/.test(pathname)) {
    // Clean up button and reset state
    observer.disconnect();
    const ul = document
      .getElementById("search-reusables__filters-bar")
      ?.querySelector("ul");
    if (ul) {
      ul.querySelectorAll("li.mp-topic-button-li").forEach((li) => li.remove());
    }
    currentButtonState = null;
    lastURL = currentUrl;
    console.log("Button removed (not on /search/results/content)");
    setTimeout(() => {
      startObservingDom();
    }, 100);
    return;
  }

  // FIX 2: Always re-check managed status on URL change or when forced
  if (lastURL !== currentUrl || !currentButtonState) {
    console.log("URL changed or forced refresh, re-checking managed status");
    currentButtonState = null; // Force refresh
  }

  // Always check for managed status on content pages
  const { isManaged } = await isCurrentPageManagedTopic();
  console.log("Rendering button; isManaged =", isManaged);

  await renderTopicButton({
    isManaged,
    onAdd: handleAddButton,
    onManage: handleManageButton,
  });

  lastURL = currentUrl;
}

// Patch history methods to catch SPA navigation
function patchHistoryMethods() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(history, args);
    setTimeout(() => onNavigationChange(), 100); // Small delay for DOM to update
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(history, args);
    setTimeout(() => onNavigationChange(), 100); // Small delay for DOM to update
  };

  window.addEventListener("popstate", () => {
    setTimeout(() => onNavigationChange(), 100); // Small delay for DOM to update
  });
}

// Called on navigation events
function onNavigationChange() {
  const newUrl = window.location.href;
  console.log("Navigation change detected:", newUrl);
  // Reset state on navigation to ensure proper re-evaluation
  currentButtonState = null;
  debounceRenderButton();
}

// FIX 2: Enhanced observer for better SPA detection
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

  // Check for URL changes (SPA navigation)
  const currentUrl = window.location.href;
  if (lastURL !== currentUrl) {
    console.log("URL change detected via observer");
    onNavigationChange();
    return;
  }

  // Only trigger if there are relevant changes to the search filters area
  const hasRelevantChanges = mutations.some((mutation) => {
    return (
      mutation.target.id === "search-reusables__filters-bar" ||
      mutation.target.closest("#search-reusables__filters-bar") ||
      Array.from(mutation.addedNodes).some(
        (node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.id === "search-reusables__filters-bar" ||
            node.querySelector("#search-reusables__filters-bar"))
      )
    );
  });

  if (hasRelevantChanges) {
    console.log("Relevant DOM change detected");
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

// Initialization
(function init() {
  console.log("Topic button script initializing...");
  patchHistoryMethods();

  // Mark as initialized and start observing
  isInitialized = true;
  startObservingDom();

  // Wait a bit for the page to load, then render
  setTimeout(() => {
    debounceRenderButton();
  }, 1000); // Reduced initial delay

  console.log("Topic button script initialized");
})();
