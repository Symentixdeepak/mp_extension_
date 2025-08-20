// browser.js - Browser API wrappers
const browser = {
  storage: {
    local: {
      get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
      set: (data) => new Promise((resolve) => chrome.storage.local.set(data, resolve)),
      remove: (keys) => new Promise((resolve) => chrome.storage.local.remove(keys, resolve))
    }
  },
  runtime: {
    sendMessage: (message) => new Promise((resolve) => 
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      })
    ),
    onMessage: {
      addListener: chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage)
    }
  },
  tabs: {
    query: (queryInfo) => new Promise((resolve) => chrome.tabs.query(queryInfo, resolve)),
    update: (tabId, updateProperties) => new Promise((resolve) =>
      chrome.tabs.update(tabId, updateProperties, resolve)
    ),
    create: (createProperties) => new Promise((resolve) =>
      chrome.tabs.create(createProperties, resolve)
    )
  }
};

module.exports = browser;
