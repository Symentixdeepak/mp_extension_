// init.js - Initialization functions
const browser = require('./browser');
const { state, setState } = require('./state');
const { WEBURL } = require('../../utils/constant');
const {
  getAuthToken,
  isLinkedInSearchResultsUrl,
} = require('../../utils/utils');

// Initialize UI state from storage
async function initializeUIState() {
  const data = await browser.storage.local.get([
    'active',
    'postsLiked',
    'commentsPosted',
    'dailyLimit'
  ]);

  // Update UI elements with storage data
  const { elements } = state;
  const {
    activeToggle,
    commentsPosted,
    postsLiked,
    limitProgress,
    limitText
  } = elements;

  if (activeToggle) activeToggle.checked = data.active !== false;
  if (commentsPosted) commentsPosted.textContent = data.commentsPosted || 0;
  if (postsLiked) postsLiked.textContent = data.postsLiked || 0;

  // Update progress bar
  const limit = data.dailyLimit || 100;
  const posted = data.commentsPosted || 0;
  const percentage = Math.min(Math.round((posted / limit) * 100), 100);

  if (limitProgress && limitText) {
    limitProgress.style.width = posted >= limit || data?.postsLiked >= limit
      ? '100%'
      : `${percentage}%`;
    limitText.textContent = posted >= limit || data?.postsLiked >= limit
      ? `${limit}/${limit}`
      : `${posted}/${limit}`;

    if (percentage > 90) {
      limitProgress.classList.replace("bg-blue-600", "bg-red-600");
    } else if (percentage > 70) {
      limitProgress.classList.replace("bg-blue-600", "bg-yellow-600");
    }
  }
}

// Check authentication and initialize
async function initialize() {
  try {
    const token = await getAuthToken();
    setState('token', token);
    
    await initializeUIState();
    
    if (token) {
      await initializeAuthenticated();
    } else {
      initializeUnauthenticated();
    }
  } catch (error) {
    console.error('Initialization error:', error);
    throw error;
  }
}

// Initialize for authenticated user
async function initializeAuthenticated() {
  const { elements } = state;
  const {
    domeContent,
    openOptionsBtn,
    statesContent,
    notLoginContent
  } = elements;

  if (domeContent) domeContent.style.display = "block";
  if (openOptionsBtn) openOptionsBtn.style.display = "block";
  if (statesContent) statesContent.style.display = "block";
  if (notLoginContent) notLoginContent.style.display = "none";

  await initializeBoardSelection();
  await triggerCoreUserDataCheck();
}

// Initialize for unauthenticated user
function initializeUnauthenticated() {
  const { elements } = state;
  const {
    importBtn,
    importBtn2,
    domeContent,
    openOptionsBtn,
    statesContent,
    notLoginContent
  } = elements;

  if (importBtn) importBtn.style.display = "none";
  if (importBtn2) importBtn2.style.display = "none";

  checkCurrentTab();
}

// Helper to check current tab state
async function checkCurrentTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || "";
    const isLinkedInPeopleSearch = url.startsWith("https://www.linkedin.com/search/results/people/");

    if (isLinkedInPeopleSearch) {
      handleLinkedInPeopleSearch();
    } else {
      handleNonLinkedInPage();
    }
  } catch (error) {
    console.error('Error checking current tab:', error);
  }
}

module.exports = {
  initialize,
  initializeUIState,
  initializeAuthenticated,
  initializeUnauthenticated,
};
