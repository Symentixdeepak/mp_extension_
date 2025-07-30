// topicButton.js - Fixed version with proper DOM checking

const { showNotification } = require("../../utils/notification");
const { populateBoards } = require("../../utils/utils");
const { DEFAULT_SETTINGS } = require("../../utils/constant");

// ... (keep all other functions the same until renderButtonIfNeeded)

// Check if topic button already exists in DOM
function isTopicButtonPresent() {
  const ul = document.getElementById("search-reusables__filters-bar")?.querySelector("ul");
  return ul && ul.querySelector("li.mp-topic-button-li") !== null;
}

// Main function that decides whether to render or cleanup the button based on current URL
async function renderButtonIfNeeded() {
  const currentUrl = window.location.href;
  const pathname = window.location.pathname;
  const ul = document.getElementById("search-reusables__filters-bar")?.querySelector("ul");

  // Button only on /search/results/content and subpaths
  if (!/^\/search\/results\/content(\/|$)/.test(pathname)) {
    if (ul) ul.querySelectorAll("li.mp-topic-button-li").forEach((li) => li.remove());
    lastURL = currentUrl;
    console.log("Button removed (not on /search/results/content)");
    return;
  }

  if (!ul) {
    console.log("Navigation bar UL not found, skipping render");
    return;
  }

  // Check if button already exists - if so, don't re-render unless URL changed
  if (isTopicButtonPresent() && lastURL === currentUrl) {
    console.log("Button already exists and URL unchanged, skipping render");
    return;
  }

  // Always check for managed status on content pages when button needs rendering
  const isManaged = await isCurrentPageManagedTopic();
  console.log("Rendering button; isManaged =", isManaged);

  await renderTopicButton({
    isManaged,
    onAdd: handleAddButton,
    onManage: handleManageButton,
  });

  lastURL = currentUrl;
}

// Observe DOM mutations to detect dynamic UI changes and trigger rendering
const observer = new MutationObserver((mutations) => {
  // Only trigger if there are relevant changes to the search filters area
  const hasRelevantChanges = mutations.some(mutation => {
    return mutation.target.id === 'search-reusables__filters-bar' ||
           mutation.target.closest('#search-reusables__filters-bar') ||
           Array.from(mutation.addedNodes).some(node => 
             node.nodeType === Node.ELEMENT_NODE && 
             (node.id === 'search-reusables__filters-bar' || 
              node.querySelector('#search-reusables__filters-bar'))
           );
  });

  if (hasRelevantChanges) {
    console.log("Relevant DOM change detected");
    debounceRenderButton();
  }
});

function startObservingDom() {
  observer.observe(document.body, { 
    childList: true, 
    subtree: true,
    attributes: false,
    attributeOldValue: false
  });
}

// Improved initialization - only render if button doesn't exist
async function initializeTopicButton() {
  console.log("Topic button script initializing...");
  
  // Check if we're on the right page and button doesn't exist
  const pathname = window.location.pathname;
  if (!/^\/search\/results\/content(\/|$)/.test(pathname)) {
    console.log("Not on content search page, skipping initialization");
    return;
  }

  // Wait for the filters bar to be available
  try {
    await waitForElementWithRetry("#search-reusables__filters-bar ul", 5, 500);
    
    // Only render if button doesn't already exist
    if (!isTopicButtonPresent()) {
      console.log("Button not found, rendering...");
      await renderButtonIfNeeded();
    } else {
      console.log("Button already exists, skipping render");
    }
  } catch (error) {
    console.log("Filters bar not found, will retry on DOM changes");
  }
}

// Initialization
(function init() {
  patchHistoryMethods();
  startObservingDom();
  
  // Initialize without setTimeout, but with proper checking
  initializeTopicButton();
  
  console.log("Topic button script initialized");
})();
