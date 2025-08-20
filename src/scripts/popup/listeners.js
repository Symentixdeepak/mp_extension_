// listeners.js - Event listener setup and handling
const browser = require('./browser');
const { state } = require('./state');
const handlers = require('./handlers');

// Set up message listeners
function setupMessageListeners() {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { importBtn, importBtn2 } = state.elements;
    
    switch (message.action) {
      case "DISABLE_IMPORT_BUTTON":
        if (importBtn) importBtn.style.display = "none";
        if (importBtn2) importBtn2.style.display = "block";
        break;
      
      case "ENABLE_IMPORT_BUTTON":
        if (importBtn) importBtn.style.display = "block";
        if (importBtn2) importBtn2.style.display = "none";
        break;
      
      case "UPDATE_BOARD_STATE":
        handlers.handleBoardStateUpdate(message.data);
        break;
    }
    
    return true;
  });
}

// Set up UI event listeners
function setupUIEventListeners() {
  const { elements } = state;
  const {
    openOptionsBtn,
    engagementlistBtn,
    backFromListStatus,
    startListEngagement,
    importMoreProspects,
    quickImportProspects,
    quickViewActivity,
    quickManageEngagement,
    quickFeedEngagment,
    boardSelect,
    quantitySelect,
    contactTypeSelect,
    segmentListTypes,
    importBtn,
    pauseResumeBtn
  } = elements;

  // Navigation
  openOptionsBtn?.addEventListener('click', 
    () => chrome.runtime.openOptionsPage()
  );

  engagementlistBtn?.addEventListener('click', 
    (e) => handlers.handleEngagementListClick(e, elements)
  );

  backFromListStatus?.addEventListener('click',
    () => handlers.handleBackFromListStatus(elements)
  );

  startListEngagement?.addEventListener('click',
    handlers.handleStartListEngagement
  );

  importMoreProspects?.addEventListener('click',
    handlers.handleImportMoreProspects
  );

  // Form controls
  boardSelect?.addEventListener('change',
    (e) => handlers.handleBoardChange(e, elements)
  );

  [quantitySelect, contactTypeSelect, segmentListTypes].forEach(select => {
    select?.addEventListener('change',
      () => handlers.checkAndSetImportButtonState(elements)
    );
  });

  // Import actions
  importBtn?.addEventListener('click',
    () => handlers.handleImport(elements)
  );

  pauseResumeBtn?.addEventListener('click',
    () => handlers.handlePauseResume(elements)
  );

  // Quick actions
  quickImportProspects?.addEventListener('click',
    handlers.handleQuickImportProspects
  );

  quickViewActivity?.addEventListener('click',
    handlers.handleQuickViewActivity
  );

  quickManageEngagement?.addEventListener('click',
    handlers.handleQuickManageEngagement
  );

  quickFeedEngagment?.addEventListener('click',
    handlers.handleQuickFeedEngagement
  );
}

module.exports = {
  setupMessageListeners,
  setupUIEventListeners
};
