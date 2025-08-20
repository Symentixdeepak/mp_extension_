// types.js - TypeScript-like type definitions for documentation
/**
 * @typedef {Object} UIElements
 * @property {HTMLElement} openOptionsBtn - Options button element
 * @property {HTMLElement} engagementlistBtn - Engagement list button
 * @property {HTMLElement} backFromListStatus - Back button from list status
 * @property {HTMLElement} startListEngagement - Start list engagement button
 * @property {HTMLElement} importMoreProspects - Import more prospects button
 * @property {HTMLElement} activeToggle - Active toggle checkbox
 * @property {HTMLElement} commentsPosted - Comments posted counter
 * @property {HTMLElement} postsLiked - Posts liked counter
 * @property {HTMLElement} limitProgress - Limit progress bar
 * @property {HTMLElement} limitText - Limit text display
 * @property {HTMLElement} domeContent - Main content container
 * @property {HTMLElement} statesContent - States content container
 * @property {HTMLElement} notLoginContent - Not logged in content
 * @property {HTMLElement} linkedinPeopleContent - LinkedIn people content
 * @property {HTMLSelectElement} boardSelect - Board selection dropdown
 * @property {HTMLSelectElement} quantitySelect - Quantity selection dropdown
 * @property {HTMLSelectElement} contactTypeSelect - Contact type selection
 * @property {HTMLSelectElement} segmentListTypes - Segment list types
 * @property {HTMLButtonElement} importBtn - Primary import button
 * @property {HTMLButtonElement} importBtn2 - Secondary import button
 * @property {HTMLButtonElement} pauseResumeBtn - Pause/Resume button
 */

/**
 * @typedef {Object} UIState
 * @property {boolean} active - Whether the extension is active
 * @property {number} postsLiked - Number of posts liked
 * @property {number} commentsPosted - Number of comments posted
 * @property {number} dailyLimit - Daily engagement limit
 */

/**
 * @typedef {Object} AppState
 * @property {UIElements} elements - DOM elements
 * @property {UIState} uiState - UI state
 * @property {string|null} token - Authentication token
 */
