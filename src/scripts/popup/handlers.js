// handlers.js - Event handler functions
const browser = require('./browser');

async function handleEngagementListClick(event, elements) {
  event.stopPropagation();
  const { listEngagementStatus } = elements;
  if (listEngagementStatus) {
    listEngagementStatus.classList.remove("hidden");
  }
}

function handleBackFromListStatus(elements) {
  const { listEngagementStatus } = elements;
  if (listEngagementStatus) {
    listEngagementStatus.classList.add("hidden");
  }
}

async function handleStartListEngagement() {
  const optionsUrl = chrome.runtime.getURL("options.html");
  const targetUrlWithFragment = optionsUrl + "#listSegments";

  try {
    await chrome.runtime.openOptionsPage();
    const tabs = await browser.tabs.query({ url: optionsUrl + "*" });
    const optionsTab = tabs.find(tab => tab.url.startsWith(optionsUrl));
    
    if (optionsTab) {
      await browser.tabs.update(optionsTab.id, {
        url: targetUrlWithFragment,
        active: true,
      });
    } else {
      await browser.tabs.create({ url: targetUrlWithFragment });
    }
  } catch (error) {
    console.error("Error handling list engagement:", error);
    await browser.tabs.create({ url: targetUrlWithFragment });
  }
}

async function handleImportMoreProspects() {
  try {
    const tabs = await browser.tabs.query({ pinned: true, currentWindow: true });
    const linkedInTab = tabs.find(tab => tab.url.includes("linkedin.com"));
    const linkedInPeopleURL = "https://www.linkedin.com/search/results/people/?network=%5B%22F%22%2C%22S%22%5D&origin=FACETED_SEARCH&sid=St%3A";

    if (linkedInTab) {
      await browser.tabs.update(linkedInTab.id, {
        active: true,
        url: linkedInPeopleURL,
      });
    } else {
      await browser.tabs.create({
        url: linkedInPeopleURL,
        pinned: true,
      });
    }
  } catch (error) {
    console.error("Error handling import prospects:", error);
  }
}

module.exports = {
  handleEngagementListClick,
  handleBackFromListStatus,
  handleStartListEngagement,
  handleImportMoreProspects
};
