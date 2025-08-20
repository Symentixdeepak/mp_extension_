// popup.js - Main popup module
const { initialize } = require('./init');
const { state, setState } = require('./state');
const { setupMessageListeners, setupUIEventListeners } = require('./listeners');

// Error handler for async operations
async function safeExecute(operation, errorMessage) {
  try {
    return await operation();
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    throw error;
  }
}

// Initialize DOM elements and store in state
function initializeElements() {
  const elements = {
    // Navigation elements
    openOptionsBtn: document.getElementById("openOptions"),
    engagementlistBtn: document.getElementById("engagementTabBtn"),
    backFromListStatus: document.getElementById("backFromListStatus"),
    startListEngagement: document.getElementById("startListEngagement"),
    importMoreProspects: document.getElementById("importMoreProspects"),

    // Status elements
    activeToggle: document.getElementById("activeToggle"),
    commentsPosted: document.getElementById("commentsPosted"),
    postsLiked: document.getElementById("postsLiked"),
    limitProgress: document.getElementById("limitProgress"),
    limitText: document.getElementById("limitText"),

    // Content sections
    domeContent: document.getElementById("dom-content"),
    statesContent: document.getElementById("stats-content"),
    notLoginContent: document.getElementById("notLoginContent"),
    linkedinPeopleContent: document.getElementById("linkedinPeopleContent"),

    // Form controls
    boardSelect: document.getElementById("boardSelect"),
    quantitySelect: document.getElementById("quantitySelect"),
    contactTypeSelect: document.getElementById("contact-list"),
    segmentListTypes: document.getElementById("segment-list"),

    // Action buttons
    importBtn: document.getElementById("importBtn"),
    importBtn2: document.getElementById("importBtn2"),
    pauseResumeBtn: document.getElementById("pause-resume"),

    // Quick action buttons
    quickImportProspects: document.getElementById("quickImportProspects"),
    quickViewActivity: document.getElementById("quickViewActivity"),
    quickManageEngagement: document.getElementById("quickManageEngagement"),
    quickFeedEngagment: document.getElementById("quickStartEngagement")
  };
  
  setState('elements', elements);
  return elements;
}

// Show error UI
function showError(message) {
  const errorContainer = document.createElement('div');
  errorContainer.className = 'error-message text-red-600 text-sm p-4';
  errorContainer.textContent = message || 'An error occurred while loading. Please try again.';
  document.body.prepend(errorContainer);
}

// Entry point
module.exports = function initializePopup() {
  document.addEventListener("DOMContentLoaded", () => {
    safeExecute(async () => {
      // Initialize app state
      const elements = initializeElements();
      
      // Set up event handlers
      setupMessageListeners();
      setupUIEventListeners();
      
      // Initialize app
      await initialize();
      
    }, "Error during popup initialization").catch(error => {
      showError();
      console.error("Fatal initialization error:", error);
    });
  });
};
