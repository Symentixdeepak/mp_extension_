// roundRobin.js

let roundRobinList = [];
let roundRobinIndex = 0;

/**
 * Initializes the round robin list with unique URLs
 */
async function getNextTopicUrl() {
  if (roundRobinList.length === 0) {
    const sessionId = await getSessionId();
    const list = await fetchTopicList(sessionId);
    roundRobinList = Array.from(new Set(list.map(item => item.url)));
    roundRobinIndex = 0;
  }

  if (!roundRobinList.length) return null;

  const url = roundRobinList[roundRobinIndex];
  roundRobinIndex = (roundRobinIndex + 1) % roundRobinList.length;
  return url;
}

function fetchTopicList(sessionId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "getTopicList", sessionId },
      (res) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else if (res?.success) {
          resolve(res.data || []);
        } else {
          reject(res?.error || "Unknown error fetching topics");
        }
      }
    );
  });
}

function getSessionId() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["user_info"], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message);
        return;
      }
      const sessionId = result?.user_info?.session_id;
      sessionId ? resolve(sessionId) : reject("No session_id found");
    });
  });
}

export default getNextTopicUrl;
