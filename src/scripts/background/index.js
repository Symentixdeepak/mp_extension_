const {
  ONE_MINUTE,
  DEFAULT_SETTINGS,
  ENGAGEMENT_KEEP_ALIVE_ALARM_NAME,
  APIURL,
  WEBURL,
} = require("../../utils/constant");
const {
  fetchTopicList,
  getAuthToken,
  updateLocalStorageObject,
} = require("../../utils/utils");

import * as engagementWorker from "./engagementWorker"; // Adjust path as needed
const FEED_URL = "https://www.linkedin.com/feed/";
const FEED_RELOAD_INTERVAL = 5 * 60 * 1000; // 30 minutes
let linkedInTab = null;
let lastNonLinkedInTime = null;
const REDIRECT_AFTER = 2 * 60 * 1000; // 2 minutes
const CHECK_INTERVAL = 5000;

console.log("Loading background scripts....");
// Set default values when extension is installed
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(
    [
      "active",
      "commentsPosted",
      "postsLiked",
      "postsScanned",
      "dailyLimit",
      "autoPostEnabled",
      "feed_commenter_active",
      "topic_commenter_active",
      "showtest",
      "minDelay",
      "maxDelay",
      "apiKey",
      "useGPT",
      "lastResetDate",
      "likePostEnabled",
      "userPrompt",
    ],
    function (data) {
      chrome.storage.local.set(
        {
          active: data.active || DEFAULT_SETTINGS.active,
          commentsPosted: data.commentsPosted || 0,
          postsScanned: data.postsScanned || 0,
          dailyLimit: data.dailyLimit || DEFAULT_SETTINGS.dailyLimit,
          autoPostEnabled:
            data.autoPostEnabled || DEFAULT_SETTINGS.autoPostEnabled,

          feed_commenter_active:
            data.feed_commenter_active !== undefined
              ? data.feed_commenter_active
              : DEFAULT_SETTINGS.isFeedCommenterActive,
          topic_commenter_active:
            data.topic_commenter_active !== undefined
              ? data.topic_commenter_active
              : DEFAULT_SETTINGS.isTopicCommenterActive,
          showtest: data.showtest || true,
          minDelay: data.minDelay || DEFAULT_SETTINGS.minDelay,
          maxDelay: data.maxDelay || DEFAULT_SETTINGS.maxDelay,
          useGPT: data.useGPT || DEFAULT_SETTINGS.useGPT,
          apiKey: data.apiKey || DEFAULT_SETTINGS.apiKey,
          lastResetDate: data.lastResetDate || new Date().toDateString(),
          likePostEnabled:
            data.likePostEnabled || DEFAULT_SETTINGS.likePostEnabled,
          userPrompt: data.userPrompt || DEFAULT_SETTINGS.userPrompt,
        },
        function () {
          console.log(
            "Default settings initialized for LinkedIn Auto Commenter."
          );
          // Perform an initial core user data check after settings are initialized
          checkCoreUserDataAPI()
            .then((result) => {
              console.log(
                "Initial core user data check on install/update:",
                result.success
                  ? `Success - User: ${result.data?.user?.name}`
                  : `Failed: ${result.error}`
              );
            })
            .catch((err) => {
              console.error(
                "Error during initial core user data check on install:",
                err
              );
            });
        }
      );
    }
  );
});

// Reset stats at midnight
function checkDailyReset() {
  const today = new Date().toDateString();

  chrome.storage.local.get("lastResetDate", function (data) {
    if (data.lastResetDate !== today) {
      chrome.storage.local.set({
        commentsPosted: 0,
        postsScanned: 0,
        postsLiked: 0,
        lastResetDate: today,
        limitNotificationShown: false,
      });
      console.log("Daily stats reset");
    }
  });
}

// Check for reset every hour
setInterval(checkDailyReset, 30 * 60 * 1000);

async function handleActivityApiCall(payload) {
  const {
    businessId,
    engagement_type,
    segmentId,
    customerId,
    posterName,
    posterProfile,
    postUrl,
    postId,
    activityId,
    isAutoPost,
    comment, // This will be used for comments
  } = payload;

  const isUpdate = !!activityId;
  const method = isUpdate ? "PATCH" : "POST";
  const apiUrl = isUpdate
    ? `${APIURL}/activity/${activityId}`
    : `${APIURL}/activity?type=36`;

  const patchPayload = {
    activity_type: 36,
    customer_ids: [customerId], // Use the actual customer ID here
    activity_data:
      engagement_type === "visit"
        ? {
            content: {
              profile_visited: true,
              profile_visit_date: new Date().toISOString(),
            },
          }
        : {
            content:
              engagement_type === "like"
                ? {
                    post_liked: true,
                    post_like_date: new Date().toISOString(),
                    post_like_type: "LIKE",
                  }
                : {
                    post_commented: true,
                    post_comment_date: new Date().toISOString(),
                    post_comment: comment,
                  },

            metadata: {
              poster_name: posterName,
              poster_profile: posterProfile,
              post_url: postUrl,
              lkdn_topic_id: segmentId,
              lkdn_post_id: postId,
            },
          },
  };

  console.log(
    `Background: Making POST to ${apiUrl} for activity`,
    patchPayload
  );
  console.log({ autoPost: isAutoPost });
  const token = await getAuthToken();

  try {
    const response = await fetch(apiUrl, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "b-id": businessId,
      },
      body: JSON.stringify(patchPayload),
    });

    if (!response.ok) {
      throw new Error(
        `API call failed: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();
    console.log("Activity API call successful:", result);

    // Store the activity ID directly in chrome.storage.local
    if (result?.data?._id || result?.data?.id) {
      const activityId = result?.data?._id;

      // Get existing topic_eng_data from chrome storage

      updateLocalStorageObject("topic_eng_data", {
        last_activity_id: activityId,
      });
    }

    return result;
  } catch (error) {
    console.error("Error making activity API call:", error);
    throw error;
  }
}

async function checkPostEngagementAPI(postId) {
  try {
    // Get auth token and business ID from storage
    const authData = await new Promise((resolve) => {
      chrome.storage.local.get(["selected_workspace"], (result) => {
        resolve(result);
      });
    });

    const authToken = await getAuthToken();
    const businessId = authData.selected_workspace;

    if (!authToken || !businessId) {
      console.log("Missing auth token or business ID for engagement check");
      return null;
    }

    const apiUrl = `${APIURL}/activity/${postId}?identifier=activity_data.metadata.lkdn_post_id`;

    console.log(
      `Background: Checking engagement for post ${postId} at ${apiUrl}`
    );

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "b-id": businessId,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Post not found means not engaged
        return null;
      }
      throw new Error(
        `API call failed: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();
    console.log(`Post ${postId} engagement check result:`, result);

    return result;
  } catch (error) {
    console.error(`Error checking engagement for post ${postId}:`, error);
    return null;
  }
}

// Listen for content script messages
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("Background script received message:", request);
  if (request.action === "updateBadge") {
    // Ensure sender.tab exists before trying to use sender.tab.id
    if (sender && sender.tab && sender.tab.id) {
      // Update extension badge with comment count
      chrome.action.setBadgeText({
        text: request.count.toString(),
        tabId: sender.tab.id,
      });

      // Set badge color
      chrome.action.setBadgeBackgroundColor({
        color: "#0073b1",
        tabId: sender.tab.id,
      });
    } else {
      // Fallback or log if sender.tab.id is not available, though for updateBadge it should be.
      chrome.action.setBadgeText({ text: request.count.toString() });
      chrome.action.setBadgeBackgroundColor({ color: "#0073b1" });
      console.warn(
        "updateBadge: sender.tab.id not available, badge updated globally."
      );
    }
  } else if (request.action === "API_POST_GENERATE_COMMENT") {
    console.log("Running background for API_POST_GENERATE_COMMENT");
    const senderTabId = sender && sender.tab ? sender.tab.id : null;

    fetch(request.url, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.authToken}`,
        "b-id": request?.businessId,
      },
      body: request.body,
    })
      .then((response) => response.json())
      .then(async (data) => {
        // Make this async to wait for tab activation
        if (
          senderTabId &&
          (data.success === undefined || data.success === true)
        ) {
          // Only activate if API call was likely successful and tab ID exists
          // try {
          //   console.log(`Activating tab ${senderTabId} before sending generated comment.`);
          //   await chrome.tabs.update(senderTabId, { active: true });
          //   // Optionally, also focus the window containing the tab
          //   const tabInfo = await chrome.tabs.get(senderTabId);
          //   if (tabInfo && tabInfo.windowId) {
          //     await chrome.windows.update(tabInfo.windowId, { focused: true });
          //   }
          // } catch (e) {
          //   console.error(`Error activating tab ${senderTabId} or its window:`, e.message);
          // }
        }
        // If response is ok, set feed_commenter_active to false and topic_commenter_active to true
        if (data && (data.success === undefined || data.success === true)) {
          chrome.storage.local.set({
            feed_commenter_active: false,
            topic_commenter_active: true,
          });
        }
        sendResponse(data);
      })
      .catch((error) => {
        console.log("error in background.js > API_POST_GENERATE_COMMENT ", {
          error,
        });
        sendResponse({
          success: false, // Ensure consistent error response
          error: error,
        });
        if (request.isEngagement) {
          engagementWorker.advanceToNextCustomer("error");
        }
      });
    return true; // Indicates asynchronous response for API_POST_GENERATE_COMMENT
  } else if (request.action === "MAKE_ACTIVITY_PATCH_API_CALL") {
    const {
      activityId,
      token,
      businessId,
      engagement_type,
      segmentId,
      isAutoPost,
      customerId,
      posterName,
      posterProfile,
      comment,
      postUrl,
      // post_details,
    } = request.payload;
    const apiUrl = `${APIURL}/activity/${activityId}`; // Ensure BASE_MANAGEPLUS_URL is used or defined

    // Construct the payload for PATCH. This is an example structure.
    // You'll need to adjust this based on your actual API requirements for appending engagement details.
    const patchPayload = {
      activity_type: 36,
      customer_ids: [customerId], // Use the actual customer ID here
      activity_data: {
        content:
          engagement_type === "like"
            ? {
                post_liked: true,
                post_like_date: new Date().toISOString(),
                post_like_type: "LIKE",
              }
            : {
                post_commented: true,
                post_comment_date: new Date().toISOString(),
                post_comment: comment,
              },
        metadata: {
          segment_id: segmentId,
          poster_name: posterName,
          poster_profile: posterProfile,
          post_url: postUrl,
        },
      },
    };

    console.log(
      `Background: Making PATCH to ${apiUrl} for activity ${activityId}`,
      patchPayload
    );
    console.log({ autoPost: isAutoPost });
    fetch(apiUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "b-id": businessId,
      },
      body: JSON.stringify(patchPayload),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: `HTTP error ${response.status}` }));
          console.error("Background: PATCH API Error:", errorData);
          throw new Error(
            errorData.message || `PATCH API Error ${response.status}`
          );
        }
        return response.json();
      })
      .then((data) => {
        console.log(
          `Background: PATCH API call successful for activity ${activityId}`,
          data
        );
        sendResponse({ success: true, data });
        // After successful PATCH, advance to the next customer

        if (isAutoPost) {
          engagementWorker.advanceToNextCustomer("patch_api_success");
        }
      })
      .catch((error) => {
        console.error(
          "Background: Error in MAKE_ACTIVITY_PATCH_API_CALL:",
          error
        );
        sendResponse({ success: false, error: error.message });

        if (isAutoPost) {
          engagementWorker.advanceToNextCustomer("patch_api_error");
        }
      });
    return true; // Indicates asynchronous response
  } else if (request.action === "MAKE_ACTIVITY_API_CALL") {
    handleActivityApiCall(request.payload);
    sendResponse({ success: true });
    return true;
  } else if (request.action === "CHECK_POST_ENGAGEMENT") {
    checkPostEngagementAPI(request.postId)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Error checking post engagement:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  } else if (request.action === "FETCH_BOARDS_BG") {
    if (!request.token) {
      sendResponse({ success: false, error: "Token not provided" });
      return true;
    }
    fetchBoardsBG(request.token)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Indicates asynchronous response
  } else if (request.action === "FETCH_BOARDS_TOPIC_LIST_BG") {
    // Get the token first
    chrome.cookies.get(
      {
        url: WEBURL,
        name: "hash_mg_value",
      },
      (cookie) => {
        const token = cookie?.value;

        if (!token) {
          sendResponse({ success: false, error: "Token not found in cookies" });
          return;
        }

        fetchBoardsBG(token)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => {
            console.error("Background fetchBoards error:", error);
            sendResponse({ success: false, error: error.message });
          });
      }
    );

    return true; // Keep the message channel open for async response
  } else if (request.action === "ADD_TOPIC_TO_LIST_BG") {
    // Get token from cookies
    chrome.cookies.get(
      { url: WEBURL, name: "hash_mg_value" },
      async (cookie) => {
        const token = cookie?.value;
        if (!token) {
          sendResponse({ success: false, error: "Token not found" });
          return;
        }

        // Get bid from chrome.storage.local
        chrome.storage.local.get(["selected_workspace"], async (result) => {
          const bid = result.selected_workspace || request.businessId;
          if (!bid) {
            sendResponse({ success: false, error: "Workspace ID not found" });
            return;
          }

          try {
            const { url, sessionId, promptValue } = request;
            const response = await fetch(`${APIURL}/linkedin-topic`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",

                Authorization: `Bearer ${token}`,
                "b-id": bid,
              },
              body: JSON.stringify({
                url,
                lkdn_profile_id: sessionId,
                prompt: promptValue,
              }),
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            chrome.storage.local.set({
              feed_commenter_active: false,
              topic_commenter_active: true,
            });

            const data = await response.json();
            sendResponse({ success: true, data });
          } catch (error) {
            console.error("Error in background addTopicToList:", error);
            sendResponse({ success: false, error: error.message });
          }
        });
      }
    );

    return true; // async
  } else if (request.action === "FETCH_CONTACT_TYPES_BG") {
    if (!request.token || !request.businessId) {
      sendResponse({
        success: false,
        error: "Token or Business ID not provided",
      });
      return true;
    }
    fetchContactTypesBG(request.token, request.businessId)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Indicates asynchronous response
  } else if (request.action === "FETCH_SEGMENT_LIST_BG") {
    if (!request.token || !request.businessId) {
      sendResponse({
        success: false,
        error: "Token or Business ID not provided",
      });
      return true;
    }
    fetchSegmentListBG(request.token, request.businessId)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Indicates asynchronous response
  } else if (request.action === "TRIGGER_CORE_USER_DATA_CHECK_FROM_POPUP") {
    console.log("Background: Received TRIGGER_CORE_USER_DATA_CHECK_FROM_POPUP");
    checkCoreUserDataAPI()
      .then((result) => {
        sendResponse(result); // Sends back { success: true/false, data/error }
      })
      .catch((error) => {
        // Fallback catch, though checkCoreUserDataAPI should handle its errors
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  } else if (request.action === "DELAYED_FEED_REDIRECT") {
    console.log("requesthit", request.action);
    const min = 4000; // 2 seconds
    const max = 6000; // 4 seconds
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(() => {
      // Use correct wildcard pattern for tab query
      chrome.tabs.query(
        {
          url: [
            "https://www.linkedin.com/feed/*",
            "https://www.linkedin.com/in/*",
          ],
        },
        (tabs) => {
          if (tabs && tabs.length > 0) {
            const updateTab = tabs[0];
            console.log(
              `Redirecting tab ${updateTab.id} (${updateTab.url}) to /feed/ after ${delay}ms`
            );
            chrome.tabs.update(updateTab.id, {
              url: request?.url || "https://www.linkedin.com/feed/",
            });
            setTimeout(() => {
              console.log(
                `Reloading tab ${updateTab.id} after redirect to /feed/`
              );
              chrome.tabs.reload(updateTab.id);
            }, 1000);
          } else {
            console.log("No matching /feed/update/ tab found for redirect.");
          }
        }
      );
    }, delay);
    return true;
  }

  // If the message is not handled by an async operation in this listener,
  // return false (or undefined implicitly) to allow other listeners to process it.
  // Synchronous operations like 'updateBadge' do not need this listener to return true.
  return false;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "createContact") {
    const { firstName, lastName, mp_linkedinProfile } = request.data;
    chrome.cookies.get(
      { url: WEBURL, name: "hash_mg_value" },
      async (cookie) => {
        const token = cookie?.value;
        if (!token) {
          sendResponse({ success: false, error: "Token not found" });
          return;
        }

        // Get bid from chrome.storage.local
        chrome.storage.local.get(["selected_workspace"], async (result) => {
          const bid = result.selected_workspace;
          if (!bid) {
            sendResponse({ success: false, error: "Workspace ID not found" });
            return;
          }

          try {
            // First, fetch contact types to get lifecycle stage
            const contactTypesData = await fetchContactTypesBG(token, bid);

            let lifecycleStageId = null;
            if (
              contactTypesData?.data?.rows &&
              contactTypesData.data.rows.length > 0
            ) {
              lifecycleStageId = contactTypesData.data.rows[0]._id;
              console.log("Using lifecycle stage ID:", lifecycleStageId);
            } else {
              console.warn("No contact types/lifecycle stages found");
            }

            // Now create the contact with lifecycle stage
            const response = await fetch(
              `${APIURL}/customer?identifier=mp_customer_linkedin_profile`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "b-id": bid,
                },
                body: JSON.stringify({
                  first_name: firstName,
                  mp_customer_linkedin_profile: mp_linkedinProfile,
                  last_name: lastName,
                  avatar: request.data.avatar || null, // Optional avatar
                  current_lifecycle_stage: lifecycleStageId, // Add lifecycle stage ID
                }),
              }
            );

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();
            sendResponse({ success: true, data });
          } catch (error) {
            console.error("Error in background createContact:", error);
            sendResponse({ success: false, error: error.message });
          }
        });
      }
    );

    return true; // Keep the message channel open for async response
  } else if (request.action === "UPDATE_CONTACT_ACTION") {
    chrome.cookies.get(
      { url: WEBURL, name: "hash_mg_value" },
      async (cookie) => {
        const token = cookie?.value;
        if (!token) {
          sendResponse({ success: false, error: "Token not found" });
          return;
        }

        // Get bid from chrome.storage.local
        chrome.storage.local.get(["selected_workspace"], async (result) => {
          const bid = result.selected_workspace || request?.dataa?.business_id;
          if (!bid) {
            sendResponse({ success: false, error: "Workspace ID not found" });
            return;
          }

          try {
            // Now create the contact with lifecycle stage
            const response = await fetch(
              `${APIURL}/customer/${request.data.contact_id}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "b-id": bid,
                },
                body: JSON.stringify({
                  summary: request.data.summary || null, // Optional summary
                  job_title: request.data.jobTitle || null, // Optional job title
                  ["address.full_address"]: request.data.address || null, // Optional address
                  avatar: request.data.avatar || null, // Optional avatar
                }),
              }
            );

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();
            sendResponse({ success: true, data });
          } catch (error) {
            console.error("Error in background createContact:", error);
            sendResponse({ success: false, error: error.message });
          }
        });
      }
    );
    return true;
  }
});

function openLinkedInTab() {
  console.log("openLinkedInTab: Function called.");
  chrome.tabs.query({ url: "*://*.linkedin.com/*" }, function (tabs) {
    console.log(
      "openLinkedInTab: Query result - found tabs:",
      tabs ? tabs.length : "null/undefined",
      tabs
    );
    if (tabs && tabs.length > 0) {
      // LinkedIn tab already exists
      console.log(
        "openLinkedInTab: LinkedIn tab(s) found. Count:",
        tabs.length
      );
      const firstLinkedInTab = tabs[0];
      if (!firstLinkedInTab.pinned) {
        console.log(
          "openLinkedInTab: First LinkedIn tab (ID:",
          firstLinkedInTab.id,
          ") is not pinned. Pinning."
        );
        chrome.tabs.update(firstLinkedInTab.id, { pinned: true }, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "openLinkedInTab: Error pinning tab:",
              chrome.runtime.lastError.message
            );
          } else {
            console.log(
              `openLinkedInTab: Successfully pinned existing LinkedIn tab: ${firstLinkedInTab.url}`
            );
          }
        });
      } else {
        console.log(
          `openLinkedInTab: LinkedIn tab (ID: ${firstLinkedInTab.id}, URL: ${firstLinkedInTab.url}) already open and pinned.`
        );
      }
    } else {
      // No LinkedIn tab found, create a new one
      console.log(
        "openLinkedInTab: No LinkedIn tab found. Attempting to create a new one."
      );
      chrome.tabs.create(
        {
          url: "https://www.linkedin.com/feed/",
          pinned: true,
        },
        (newTab) => {
          if (chrome.runtime.lastError) {
            console.error(
              "openLinkedInTab: Error creating new LinkedIn tab:",
              chrome.runtime.lastError.message
            );
          } else if (newTab) {
            console.log(
              `openLinkedInTab: New LinkedIn feed tab opened and pinned. Tab ID: ${newTab.id}, URL: ${newTab.url}`
            );
          } else {
            console.error(
              "openLinkedInTab: chrome.tabs.create did not return a tab object and no error was reported."
            );
          }
        }
      );
    }
  });
}
chrome.runtime.onStartup.addListener(function () {
  console.log("onStartup: Scheduling openLinkedInTabActual with a delay.");
  setTimeout(() => {
    openLinkedInTab();
    // Perform core user data check on browser startup
    checkCoreUserDataAPI()
      .then((result) => {
        console.log(
          "Core user data check on startup:",
          result.success
            ? `Success - User: ${result.data?.user?.name}`
            : `Failed: ${result.error}`
        );
      })
      .catch((err) => {
        console.error("Error during core user data check on startup:", err);
      });
  }, 10000); // Existing 10-second delay
});
chrome.runtime.onInstalled.addListener(openLinkedInTab);

// Listener to handle requests for active tab URL use to get active tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getActiveTabUrl") {
    // Search all tabs (not just active) for LinkedIn
    chrome.tabs.query({ url: "https://www.linkedin.com/*" }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error("Tab query error:", chrome.runtime.lastError);
        sendResponse({ url: null, error: chrome.runtime.lastError });
        return;
      }

      if (tabs.length > 0) {
        console.log("Found LinkedIn tab with URL:", tabs[0].url);
        sendResponse({ url: tabs[0].url });
      } else {
        console.warn("No LinkedIn tab found");
        sendResponse({ url: null });
      }
    });
    return true; // Required for async response
  }
});

function getCookie(callback) {
  chrome.cookies.get({ url: WEBURL, name: "hash_mg_value" }, function (cookie) {
    if (cookie) {
      callback(cookie.value);
    } else {
      callback(null);
    }
  });
}

// Listen for messages from the popup to provide the cookie value
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TOKEN") {
    getCookie((value) => {
      sendResponse({ token: value });
    });
    // Indicate that the response will be sent asynchronously
    return true;
  }
});

// Function to show loading state
function showLoading() {
  chrome.storage.local.set({ loading: true });
}

// Function to hide loading state
function hideLoading() {
  chrome.storage.local.set({ loading: false });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "fetching_start") {
    showLoading();
  } else if (message.type === "fetching_complete") {
    hideLoading();
  } else if (message.type === "fetching_error") {
    hideLoading();
    chrome.notifications.create({
      type: "basic",
      title: "Error",
      message: "An error occurred while fetching data.",
    });
  }
});

// Reset loading state when the page is refreshed
chrome.runtime.onStartup.addListener(() => {
  hideLoading(); // Ensure loading is hidden on startup
});

async function saveScrapedData(
  data,
  authToken,
  contact_type,
  board,
  segment_id
) {
  try {
    console.log("Background: Saving scraped data to backend", {
      dataLength: data.length,
      contact_type,
      board,
      segment_id,
    });

    const generatedData = {
      lifecycle_id: contact_type,
      duplicate_identifier: "mp_customer_linkedin_profile",
      rows: data,
      segment_id: segment_id,
    };

    const response = await fetch(`${APIURL}/scrape`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + authToken,
        "b-id": board,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(generatedData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Background: API Error Response:", errorText);
      throw new Error(`Error saving data: ${response.status} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    console.log("Background: Data saved successfully:", jsonResponse);

    return { status: "success", result: jsonResponse };
  } catch (error) {
    console.error("Background: Error during save:", error);
    return { status: "error", error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "saveScrapedData") {
    console.log("Background: Received saveScrapedData request", {
      prospectsCount: message.metadata?.prospects?.length,
      contact_type: message.metadata?.contact_type,
      board: message.metadata?.board,
      segment_list: message.metadata?.segment_list,
    });

    saveScrapedData(
      message.metadata?.prospects,
      message?.metadata?.authToken,
      message?.metadata?.contact_type,
      message?.metadata?.board,
      message?.metadata?.segment_list
    )
      .then((result) => {
        console.log("Background: saveScrapedData completed:", result);
        if (result.status === "success") {
          sendResponse({ status: "success", result: result.result });
        } else {
          sendResponse({ status: "error", error: result.error });
        }
      })
      .catch((error) => {
        console.error("Background: Error in saveScrapedData:", error);
        sendResponse({ status: "error", error: error.message });
      });

    return true; // Keep the message channel open for async response
  }
});

// Listen for messages from the popup use to get jessionid
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCookie") {
    chrome.cookies.getAll({ domain: ".www.linkedin.com" }, (cookies) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching cookies:", chrome.runtime.lastError);
        sendResponse({ error: "Failed to fetch cookies" });
        return;
      }

      // Check if cookies are retrieved and if JSESSIONID exists
      if (cookies && cookies.length > 0) {
        const jsessionIdCookie = cookies.find(
          (cookie) => cookie.name === "JSESSIONID"
        );
        if (jsessionIdCookie) {
          sendResponse({ jsessionId: jsessionIdCookie.value });
        } else {
          sendResponse({ error: "JSESSIONID cookie not found" });
        }
      } else {
        sendResponse({ error: "No cookies found" });
      }
    });
    return true; // Indicates that the response will be sent asynchronously
  }
});
// Example: d:\ManagePlus\mp-extensions\linkedin-engagement\src\js\background.js

// Import your new engagement worker functions

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startEngagement") {
    engagementWorker.handleStartEngagementRequest(request, sendResponse);
    return true; // Indicates asynchronous response
  } else if (request.action === "stopEngagement") {
    engagementWorker.handleStopEngagementRequest(request, sendResponse);
    return true; // Indicates asynchronous response
  } else if (request.action === "getEngagementStatus") {
    // If you need other parts of the extension to query status directly
    engagementWorker.handleGetEngagementStatusRequest(request, sendResponse);
    return true;
  } else if (request.action === "USER_ACTIVITY_DONE") {
    // Message from activityEngager.js (content script) indicating it's done with a user
    console.log(
      "Background: Received USER_ACTIVITY_DONE from content script.",
      request.payload
    );
    // Tell engagementWorker to proceed to the next customer
    engagementWorker.advanceToNextCustomer(request.payload.status); // Pass status as reason
    sendResponse({
      success: true,
      message: "Acknowledged. Advancing to next customer.",
    });
    return true; // Async not strictly needed here but good practice
  }
  // ... any other message listeners you have ...
  return false; // For synchronous messages or if not handled
});

// Add this new listener for messages from your website
chrome.runtime.onMessageExternal.addListener(
  async (request, sender, sendResponse) => {
    console.log(
      "Message received from external source (website):",
      sender.url,
      request
    );

    if (request.action === "FROM_WEBSITE_GET_ENGAGEMENT_STATUS") {
      // Use the existing engagementWorker's status handler
      engagementWorker.handleGetEngagementStatusRequest(
        request,
        (statusResponse) => {
          console.log(
            "[BackgroundIndex] Sending engagement status to website via onMessageExternal:",
            statusResponse
          );
          sendResponse(statusResponse); // Forward the response to the website
        }
      );
      return true; // Indicates that the response is asynchronous
    }

    if (request.action === "FROM_WEBSITE_START_ENGAGEMENT") {
      const { listId, businessId, prompt } = request.payload;

      if (!listId || !businessId) {
        sendResponse({
          success: false,
          message: "Missing listId or businessId from website.",
        });
        return false; // Not asynchronous in this error case
      }

      // Fetch the token. The extension is responsible for its own authentication.
      getCookie(async (token) => {
        // getCookie is defined in this file
        if (!token) {
          sendResponse({
            success: false,
            message:
              "Authentication token not found in extension. Please log in via ManagePlus.",
          });
          return;
        }

        // Call the existing handleStartEngagementRequest from engagementWorker
        // It already checks if an engagement is in progress.
        engagementWorker.handleStartEngagementRequest(
          {
            listId,
            token, // Pass the fetched token
            businessId,
            prompt: prompt || DEFAULT_SETTINGS.userPrompt, // Use provided prompt or a default
            settings: {}, // engagementWorker merges this with stored/default settings
          },
          (startResponse) => {
            // This callback is for the internal message passing of handleStartEngagementRequest
            console.log(
              "Response from handleStartEngagementRequest (for website):",
              startResponse
            );
            sendResponse(startResponse); // Forward the response to the website
          }
        );
      });

      return true; // Indicates that the response is asynchronous
    }

    if (request.action === "FROM_WEBSITE_STOP_ENGAGEMENT") {
      engagementWorker.handleStopEngagementRequest(
        { message: "Stop request from website." }, // listId is handled internally by currentEngagement
        (stopResponse) => {
          console.log(
            "Response from handleStopEngagementRequest (for website):",
            stopResponse
          );
          sendResponse(stopResponse);
        }
      );
      return true; // Async
    }

    return false; // Default for unhandled actions
  }
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_AUTH_TOKEN") {
    chrome.cookies.get({ url: WEBURL, name: "hash_mg_value" }, (cookie) => {
      sendResponse({ token: cookie?.value || null });
    });
    return true;
  }

  if (request.action === "CREATE_CONTACT_BG") {
    const { token, workspaceId, first_name, last_name, profileUrl, avatar } =
      request;

    fetch(`${APIURL}/customer?identifier=mp_customer_linkedin_profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "b-id": workspaceId,
      },
      body: JSON.stringify({
        first_name,
        last_name,
        avatar,
        mp_customer_linkedin_profile: profileUrl,
      }),
    })
      .then((res) =>
        res.json().then((data) => sendResponse({ success: true, data }))
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true; // Indicates async response
  }
});

chrome.runtime.onStartup.addListener(() => {
  // Ensure this calls the actual resume function from engagementWorker.js
  engagementWorker.resumeEngagementOnStartup();
});

// Schedule resumeEngagementOnStartup to run every 10 hours
chrome.alarms.create("resumeEngagementAlarm", {
  periodInMinutes: 3 * 60, // 10 hours in minutes
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "resumeEngagementAlarm") {
    engagementWorker.resumeEngagementOnStartup();
  }
});

// Listen for tab removals to manage the targetTabId
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  engagementWorker.handleTabRemoved(tabId);
});

// Listen for our keep-alive alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ENGAGEMENT_KEEP_ALIVE_ALARM_NAME) {
    // console.log("Background: Keep-alive alarm triggered.");
    engagementWorker.handleKeepAlivePing();
  }
  // Add other alarm handlers here if you have more alarms
});

// You might also want to initialize the engagement state on install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  // This listener specifically handles engagement-related keys.
  // General settings have their own onInstalled listener at the top of the file.
  if (details.reason === "install") {
    // ONLY clear for a fresh install
    await chrome.storage.local.remove([
      // All keys from ENGAGEMENT_STORAGE_KEYS in engagementWorker.js
      "engagement_status",
      "engagement_data_listId",
      "engagement_data_currentIndex",
      "engagement_data_token",
      "engagement_data_businessId",
      "engagement_data_settings",
      "engagement_data_currentActivityId",
      "engagement_target_tab_id",
      "engagement_data_prompt",
      // Include any legacy keys you were using for engagement state
      "engagement_segment_id", // Legacy key, also used by ListSegmentManager
    ]);
    console.log(
      "Extension freshly installed. Cleared engagement-related storage."
    );
  } else if (details.reason === "update") {
    console.log(
      "Extension updated. Engagement state will be checked for resumption on browser startup."
    );
  }
});

console.log("ManagePlus Background Service Worker Loaded.");

// New API function for core user data check (e.g., on init, startup, popup open)
async function checkCoreUserDataAPI() {
  console.log("Attempting to fetch core user data via API...");
  try {
    const token = await new Promise((resolve) => {
      getCookie(resolve); // Uses the existing getCookie function to get 'hash_mg_value'
    });

    if (!token) {
      console.warn(
        "checkCoreUserDataAPI: No auth token (hash_mg_value) found. Skipping API call."
      );
      return { success: false, error: "No auth token found" };
    }

    // Using /user/me endpoint as an example. Change if a different API is needed.
    const response = await fetch(`${APIURL}/user/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Add other necessary headers if required
      },
    });

    if (!response.ok) {
      let errorDetails = `API call failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorDetails =
          errorData.message || JSON.stringify(errorData) || errorDetails;
      } catch (e) {
        try {
          const textError = await response.text();
          if (textError) errorDetails += ` - ${textError}`;
        } catch (textEx) {
          /* Ignore if reading text body fails */
        }
      }
      console.error("checkCoreUserDataAPI:", errorDetails);
      // Optionally, handle specific errors e.g., clear token on 401/403
      return { success: false, error: errorDetails };
    }

    const data = await response.json();
    console.log(
      "checkCoreUserDataAPI: Successfully fetched core user data for:",
      data.payload?.user?.name,
      data.payload?.user?.email
    );
    // You could store this data or parts of it in chrome.storage.local if needed for other background tasks
    // chrome.storage.local.set({ coreUser: data.payload.user, lastUserCheck: new Date().toISOString() });
    return { success: true, data: data.payload }; // Return the main payload
  } catch (error) {
    console.error(
      "checkCoreUserDataAPI: Exception during API call:",
      error.message,
      error.stack
    );
    return { success: false, error: error.message };
  }
}

// API fetching functions
async function fetchBoardsBG(token) {
  const response = await fetch(`${APIURL}/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let errorDetails = `HTTP error ${response.status}`;
    try {
      const errorData = await response.json();
      errorDetails =
        errorData.message || JSON.stringify(errorData) || errorDetails;
    } catch (e) {
      /* Ignore if parsing error body fails */
    }
    console.error("Background: Failed to fetch boards:", errorDetails);
    throw new Error(`Failed to fetch boards: ${errorDetails}`);
  }
  return await response.json();
}

async function fetchContactTypesBG(token, businessId) {
  const response = await fetch(
    `${APIURL}/lifecyclestage/list?rows_per_page=0`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "b-id": businessId,
      },
    }
  );
  if (!response.ok) {
    let errorDetails = `HTTP error ${response.status}`;
    try {
      const errorData = await response.json();
      errorDetails =
        errorData.message || JSON.stringify(errorData) || errorDetails;
    } catch (e) {
      /* Ignore if parsing error body fails */
    }
    console.error("Background: Contact type loading failed:", errorDetails);
    throw new Error(`Contact type loading failed: ${errorDetails}`);
  }
  return await response.json();
}

async function fetchSegmentListBG(token, businessId) {
  const response = await fetch(
    `${APIURL}/segmentation/list?type=1&show_intent=false&page_num=1&rows_per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "b-id": businessId,
      },
    }
  );
  if (!response.ok) {
    let errorDetails = `HTTP error ${response.status}`;
    try {
      const errorData = await response.json();
      errorDetails =
        errorData.message || JSON.stringify(errorData) || errorDetails;
    } catch (e) {
      /* Ignore if parsing error body fails */
    }
    console.error("Background: Segment list loading failed:", errorDetails);
    throw new Error(`Segment list loading failed: ${errorDetails}`);
  }
  return await response.json();
}

// --- Periodically fetch topic list and store in chrome.storage.local ---
async function fetchAndStoreTopicList() {
  try {
    // You may want to get the sessionId from storage or a secure place
    const { sessionId } = await new Promise((resolve) => {
      chrome.storage.local.get(["sessionId"], resolve);
    });
    if (!sessionId) return;
    const { fetchTopicList } = require("../../utils/utils");
    const topicList = await fetchTopicList(sessionId);
    chrome.storage.local.set({ topicListCache: topicList });
    console.log("Background: Topic list updated", topicList);
  } catch (e) {
    console.warn("Background: Failed to fetch topic list", e);
  }
}

// Fetch immediately on startup
fetchAndStoreTopicList();
// Fetch every 2 minutes
setInterval(fetchAndStoreTopicList, 2 * 60 * 1000);

console.log(
  "LinkedIn Auto-Redirect on Idle/Switch: Background Service Active."
);
// background.js
chrome.alarms.create("engageTimer", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "engageTimer") {
    chrome.tabs.query({ url: "*://*.linkedin.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["js/activityEngager.js"], // Assuming this is the path to your bundled content script
        });
      });
    });
  }
});

function isLinkedInNonFeed(url) {
  return url?.includes("linkedin.com/") && !url.includes("linkedin.com/feed");
}

function isLinkedInNonTopic(url) {
  return (
    url?.includes("linkedin.com/") &&
    !url.includes("linkedin.com/search/results/content")
  );
}

setInterval(() => {
  chrome.storage.local.get(
    [
      "engagement_status",
      "postsLiked",
      "commentsPosted",
      "dailyLimit",
      "active",
      "feed_commenter_active",
      "topic_commenter_active",
    ],
    async (result) => {
      const {
        engagement_status,
        postsLiked = 0,
        commentsPosted = 0,
        dailyLimit = 0,
        active,
        feed_commenter_active,
        topic_commenter_active,
      } = result;

      const engagementLimitReached =
        dailyLimit > 0 &&
        (postsLiked >= dailyLimit || commentsPosted >= dailyLimit);

      if (
        engagement_status === "started" ||
        engagementLimitReached ||
        !active ||
        (!feed_commenter_active && !topic_commenter_active) // Both false = do nothing
      )
        return;

      chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        async (activeTabs) => {
          const activeTab = activeTabs[0];
          if (!activeTab) {
            lastNonLinkedInTime = null;
            return;
          }
          if (!activeTab.url) {
            lastNonLinkedInTime = null;
            return;
          }

          if (activeTab.url.includes("linkedin.com")) {
            lastNonLinkedInTime = null;
          } else {
            if (!lastNonLinkedInTime) {
              lastNonLinkedInTime = Date.now();
            } else if (Date.now() - lastNonLinkedInTime > REDIRECT_AFTER) {
              chrome.tabs.query(
                { url: "*://*.linkedin.com/*" },
                async (allLinkedInTabs) => {
                  let tabToRedirect;
                  let redirectUrl;

                  // Priority: If both are true, topic commenter takes precedence
                  if (topic_commenter_active) {
                    // Topic commenter logic (works when topic is true, regardless of feed status)
                    tabToRedirect = allLinkedInTabs.find((tab) =>
                      isLinkedInNonTopic(tab.url)
                    );
                    if (tabToRedirect) {
                      redirectUrl = await getRandomTopicUrl();
                      console.log(
                        `User not on LinkedIn tab for >1min. Redirecting non-topic LinkedIn tab ${tabToRedirect.id} (${tabToRedirect.url}) to topic: ${redirectUrl}.`
                      );
                    }
                  } else if (feed_commenter_active && !topic_commenter_active) {
                    // Feed commenter logic (only when feed is true AND topic is false)
                    tabToRedirect = allLinkedInTabs.find((tab) =>
                      isLinkedInNonFeed(tab.url)
                    );
                    if (tabToRedirect) {
                      redirectUrl = FEED_URL;
                      console.log(
                        `User not on LinkedIn tab for >1min. Redirecting non-feed LinkedIn tab ${tabToRedirect.id} (${tabToRedirect.url}) to feed.`
                      );
                    }
                  }

                  if (tabToRedirect && redirectUrl) {
                    chrome.tabs.update(tabToRedirect.id, { url: redirectUrl });
                  }

                  lastNonLinkedInTime = null;
                }
              );
            }
          }
        }
      );
    }
  );
}, CHECK_INTERVAL);

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");

  chrome.alarms.create("reloadFeed", {
    periodInMinutes: 12,
  });

  console.log("Alarm created");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log("Alarm triggered:", alarm.name);

  if (alarm.name !== "reloadFeed") return;

  chrome.storage.local.get(
    [
      "engagement_status",
      "postsLiked",
      "commentsPosted",
      "dailyLimit",
      "active",
      "feed_commenter_active",
      "topic_commenter_active", // Add this to storage query
    ],
    async (result) => {
      // Make this async to handle await
      console.log("Got storage:", result);

      const {
        engagement_status,
        postsLiked = 0,
        commentsPosted = 0,
        dailyLimit = 0,
        active,
        feed_commenter_active,
        topic_commenter_active, // Extract topic_commenter_active
      } = result;

      const engagementLimitReached =
        dailyLimit > 0 &&
        (postsLiked >= dailyLimit || commentsPosted >= dailyLimit);

      if (
        engagement_status === "started" ||
        engagementLimitReached ||
        !active ||
        (!feed_commenter_active && !topic_commenter_active) // Both false = do nothing
      )
        return;

      // Determine which URL pattern to search for and which URL to use
      let searchPattern;
      let redirectUrl;

      if (topic_commenter_active) {
        // Topic commenter logic (takes precedence if both are true)
        searchPattern = [
          "https://www.linkedin.com/feed/",
          "*://www.linkedin.com/search/results/content*",
        ];
        redirectUrl = await getRandomTopicUrl(); // Get random topic URL
        console.log("Topic commenter active - will redirect to:", redirectUrl);
      } else if (feed_commenter_active && !topic_commenter_active) {
        // Feed commenter logic (only when feed is true AND topic is false)
        searchPattern = "https://www.linkedin.com/feed/";
        redirectUrl = "https://www.linkedin.com/feed/";
        console.log("Feed commenter active - will redirect to feed");
      }

      if (!redirectUrl) {
        console.log("No redirect URL determined, exiting");
        return;
      }

      // Query for tabs based on the determined pattern
      chrome.tabs.query({ url: searchPattern }, (tabs) => {
        if (tabs && tabs.length > 0) {
          const updateTab = tabs[0];
          console.log(
            `Updating tab ${updateTab.id} from ${updateTab.url} to ${redirectUrl}`
          );

          chrome.tabs.update(updateTab.id, {
            url: redirectUrl,
          });

          setTimeout(() => {
            chrome.tabs.reload(updateTab.id);
          }, 1000);
        } else {
          console.log("No matching tabs found for pattern:", searchPattern);
        }
      });
    }
  );
});

let secondsOnFeedUpdate = 0;

// Start recurring alarm (every 10 seconds)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("checkTabUrl", { periodInMinutes: 0.5 }); // ~10 seconds
  console.log("Alarm created to check active tab");
});

// Runs every 10 seconds
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "checkTabUrl") return;

  // Get storage values to determine which commenter is active
  chrome.storage.local.get(
    ["topic_commenter_active", "feed_commenter_active"],
    async (result) => {
      const { topic_commenter_active, feed_commenter_active } = result;

      // Query for both feed/update URLs and profile URLs (when topic commenter is active)
      const queryPatterns = ["https://www.linkedin.com/feed/update/*"];

      // Add profile URL pattern if topic commenter is active
      if (topic_commenter_active) {
        queryPatterns.push("https://www.linkedin.com/in/*");
      }

      chrome.tabs.query({ url: queryPatterns }, async (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.url) return;

        const isOnFeedUpdate = activeTab.url.startsWith(
          "https://www.linkedin.com/feed/update/"
        );

        const isOnProfilePage = activeTab.url.match(
          /^https:\/\/www\.linkedin\.com\/in\/[^\/]+\/?$/
        );

        // Check if user is on either feed/update or profile page (when topic commenter is active)
        const shouldTrackTime =
          isOnFeedUpdate || (topic_commenter_active && isOnProfilePage);

        if (shouldTrackTime) {
          secondsOnFeedUpdate += 10;

          if (isOnFeedUpdate) {
            console.log(
              `User on feed/update for ${secondsOnFeedUpdate} seconds`
            );
          } else if (isOnProfilePage) {
            console.log(
              `User on profile page (${activeTab.url}) for ${secondsOnFeedUpdate} seconds`
            );
          }

          if (secondsOnFeedUpdate >= 290) {
            // 5 minutes = 300 seconds
            console.log("Redirecting after 5 minutes on tracked page");

            let redirectUrl;

            // Determine redirect URL based on active commenter
            if (topic_commenter_active) {
              // Topic commenter logic (takes precedence if both are true)
              redirectUrl = await getRandomTopicUrl();
              console.log(
                "Topic commenter active - redirecting to:",
                redirectUrl
              );
            } else if (feed_commenter_active && !topic_commenter_active) {
              // Feed commenter logic (only when feed is true AND topic is false)
              redirectUrl = "https://www.linkedin.com/feed/";
              console.log("Feed commenter active - redirecting to feed");
            } else {
              // Fallback to feed if neither is properly configured
              redirectUrl = "https://www.linkedin.com/feed/";
              console.log("No active commenter found - defaulting to feed");
            }

            chrome.tabs.update(activeTab.id, {
              url: redirectUrl,
            });
            secondsOnFeedUpdate = 0;
          }
        } else {
          if (secondsOnFeedUpdate > 0) {
            console.log("User left tracked page. Resetting counter.");
          }
          secondsOnFeedUpdate = 0;
        }
      });
    }
  );
});

// --- Listen for getTopicList requests from content scripts ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "getTopicList" && request.sessionId) {
    fetchTopicList(request.sessionId)
      .then((list) => sendResponse({ success: true, data: list }))
      .catch((err) =>
        sendResponse({ success: false, error: err?.message || String(err) })
      );
    // Indicate async response
    return true;
  }
  // ...existing message handlers...dd
});
