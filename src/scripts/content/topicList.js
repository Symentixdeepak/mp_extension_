const tracker = require("../../utils/engagement");
const { logger } = require("../../utils/logger");
const {
  getPostId,
  getPostUrl,
  getPosterName,
  getPosterProfile,
  getRandomDelay,
  waitForElement,
  callApi,
  getFirstUgcId,
  extractFirstAndLastName,
  extractLinkedInProfile,
  extractAvatarUrl,
  getRandomTopicUrl,
  updateLocalStorageObject,
  getFromChromeStorage,
  setToChromeStorage,
  getSecChUaHeader,
  getSecChUaMobile,
  getSecChUaPlatform,
  getXLiLang,
  getAcceptLanguage,
  getXLiTrackHeader,
} = require("../../utils/utils");
const { showNotification } = require("../../utils/notification");
const {
  DEFAULT_SETTINGS,
  CommentLengthToWordsLength,
  MaxTokens,
  APIURL,
  defaultStartPrompt,

  topicSystemPrompt,
} = require("../../utils/constant");
const {
  simulateMouseClick,
  simulateTyping,
  setCommentInputValue,
} = require("../../utils/simulation");
const getSelectors = require("../../utils/selectors");

let extensionActive = DEFAULT_SETTINGS.active;
let dailyLimit = DEFAULT_SETTINGS.dailyLimit;
let commentsPosted = 0;
let postsLiked = 0;
let connectionSent = 0; // Track connections sent
let postsScanned = 0;
let autoPostEnabled = DEFAULT_SETTINGS.autoPostEnabled;
let minDelay = DEFAULT_SETTINGS.minDelay;
let maxDelay = DEFAULT_SETTINGS.maxDelay;
let lastProcessedPosts = new Set();
let isProcessing = false;
let apiKey = DEFAULT_SETTINGS.apiKey;
let useGPT = DEFAULT_SETTINGS.useGPT;
let likePostEnabled = DEFAULT_SETTINGS.likePostEnabled;
let commentLength = DEFAULT_SETTINGS.commentLength;
let SELECTORS = null;
let systemPrompt = defaultStartPrompt;
let userPrompt = DEFAULT_SETTINGS.userPrompt;
let isInitialized = false;
let currentUrl = window.location.href;
let initializationTimeout = null;
let apiPageStart = 0; // Page start counter
let processedPostIds = new Set(); // Track processed post IDs to avoid duplicates
let isApiPaginating = false; // Flag to prevent startScanning interference
const MAX_API_PAGES = 5; // Maximum pages to visit

// === Delay Management Utilities ===
const NEXT_ENGAGEMENT_KEY = "mp_next_engagement_time";

function getNextEngagementTime() {
  const val = localStorage.getItem(NEXT_ENGAGEMENT_KEY);
  return val ? parseInt(val, 10) : null;
}

function setNextEngagementTime(min, max) {
  const delay = getRandomDelay(min, max);
  const nextTime = Date.now() + delay;
  localStorage.setItem(NEXT_ENGAGEMENT_KEY, nextTime.toString());
  return delay;
}

async function waitForNextEngagement(min, max) {
  const nextTime = getNextEngagementTime();
  const now = Date.now();
  if (nextTime && now < nextTime) {
    const waitMs = nextTime - now;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return waitMs;
  } else if (!nextTime) {
    // First run: random delay
    const delay = getRandomDelay(min, max);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay;
  }
  return 0;
}

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
              const topicDataToSave = {
                topic_id: managedTopic._id,
                goal_prompt: managedTopic.goal_prompt,
                list_id: managedTopic.segment_id,
                business_id: managedTopic.business_id,
                profile_prompt: managedTopic.profile_prompt,
              };

              if (managedTopic.engagement_types) {
                topicDataToSave.engagement_types =
                  managedTopic.engagement_types;
              }

              // ✅ Clear old topic_eng_data first, then set new one
              chrome.storage.local.set({ topic_eng_data: {} }, () => {
                console.log(
                  "[isCurrentPageManagedTopic] Cleared old topic_eng_data"
                );

                chrome.storage.local.set(
                  { topic_eng_data: topicDataToSave },
                  () => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        "[isCurrentPageManagedTopic] Storage error:",
                        chrome.runtime.lastError
                      );
                    } else {
                      console.log(
                        "[isCurrentPageManagedTopic] ✅ topic_eng_data saved:",
                        topicDataToSave
                      );
                    }
                  }
                );
              });

              // ✅ Save workspace + prompt too
              chrome.storage.local.set(
                {
                  selected_workspace: managedTopic?.business_id,
                  topic_prompt: managedTopic?.prompt,
                },
                () => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "[isCurrentPageManagedTopic] Chrome storage error:",
                      chrome.runtime.lastError
                    );
                  } else {
                    console.log(
                      "[isCurrentPageManagedTopic] ✅ Workspace and topic prompt saved successfully"
                    );
                  }
                }
              );

              resolve({
                isManaged: true,
                topicId: managedTopic._id,
                topic: managedTopic,
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

const getAuthToken = () => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "GET_AUTH_TOKEN" }, (response) => {
      resolve(response?.token || null);
    });
  });
};

// Initialize extension

async function initialize() {
  // Prevent multiple initializations
  if (isInitialized && currentUrl === window.location.href) {
    console.log("Already initialized for this URL, skipping...");
    return;
  }

  console.log("LinkedIn Auto Commenter initializing...");

  const statusData = await chrome.storage.local.get(["engagement_status"]);
  const engagementStatus = statusData.engagement_status;
  const isFeedCommenterActive = await chrome.storage.local.get([
    "topic_commenter_active",
  ]);
  const authToken = await getAuthToken();
  if (!authToken) {
    return;
  }
  const topicCheck = await isCurrentPageManagedTopic();
  console.log({ topicCheck });

  // Check if current URL matches LinkedIn feed update pattern or search results
  const isFeedUpdatePage = window.location.pathname.startsWith("/feed/update/");
  const isSearchResultsPage = window.location.pathname.startsWith(
    "/search/results/content"
  );

  // Return early (don't initialize) if any of these conditions are true:
  // Note: Removed isSearchResultsPage from the condition so search results pages always proceed
  if (
    engagementStatus === "started" ||
    !isFeedCommenterActive?.topic_commenter_active ||
    (!topicCheck?.isManaged && !isFeedUpdatePage)
  ) {
    console.log("LinkedIn Auto Commenter: Initialization skipped.");

    if (engagementStatus === "started") {
      console.log("Reason: Engagement status is 'started'");
    } else if (!isFeedCommenterActive?.topic_commenter_active) {
      console.log("Reason: Topic commenter is not active");
    } else if (!topicCheck?.isManaged && !isFeedUpdatePage) {
      console.log("Reason: Topic not managed and not on feed update page");
    }

    return; // Exit - don't initialize
  }

  // Load settings from storage
  async function refreshSettings() {
    const data = await chrome.storage.local.get([
      "active",
      "commentsPosted",
      "postsLiked",
      "postsScanned",
      "dailyLimit",
      "autoPostEnabled",
      "minDelay",
      "maxDelay",
      "apiKey",
      "useGPT",
      "lastResetDate",
      "connectionSent",
      "likePostEnabled",
      "commentLength",
      "userPrompt",
      "systemPrompt",
      "topic_eng_data",
    ]);

    console.log("refresh setting starts...");
    extensionActive = data.active !== false;

    // Check if we need to reset daily counts
    const today = new Date().toDateString();
    if (data.lastResetDate !== today) {
      chrome.storage.local.set({
        commentsPosted: 0,
        postsScanned: 0,
        postsLiked: 0,
        lastResetDate: today,
      });
      commentsPosted = 0;
      postsScanned = 0;
      postsLiked = 0;
    } else {
      commentsPosted = data.commentsPosted || 0;
      postsScanned = data.postsScanned || 0;
      postsLiked = data.postsLiked || 0;
    }

    dailyLimit = data.dailyLimit || DEFAULT_SETTINGS.dailyLimit;
    autoPostEnabled = data.autoPostEnabled || false;
    minDelay = data.minDelay || DEFAULT_SETTINGS.minDelay;
    maxDelay = data.maxDelay || DEFAULT_SETTINGS.maxDelay;
    apiKey = data.apiKey || "";
    useGPT = data.useGPT !== false;
    likePostEnabled = data.likePostEnabled !== false;
    commentLength = data.commentLength || DEFAULT_SETTINGS.commentLength;
    userPrompt =
      data?.topic_eng_data?.prompt ||
      data.userPrompt ||
      DEFAULT_SETTINGS.userPrompt;
    systemPrompt = data.systemPrompt || defaultStartPrompt;
    console.log("refresh setting finished...", data);
  }

  await refreshSettings();
  if (extensionActive) {
    await startScanning();
  }

  // Add message listener for popup communication (only once)
  if (!isInitialized) {
    chrome.runtime.onMessage.addListener(async function (
      request,
      sender,
      sendResponse
    ) {
      if (request.action === "updateActiveState") {
        console.log("settings got update!!!");
        await refreshSettings();
        console.log({ extensionActive });
        if (extensionActive && !isProcessing) {
          await startScanning();
        }
      }
      return true;
    });
  }

  // Set initialization flag to true at the end of successful initialization
  isInitialized = true;
  currentUrl = window.location.href;
  console.log("LinkedIn Auto Commenter successfully initialized");
}

//jession token
async function getCsrfToken() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "getCookie" }, (response) => {
      if (response.error) {
        reject(response.error);
        console.log({ dfdfd: response });
      } else {
        // Clean the CSRF token by removing extra quotes
        const rawCsrfToken = response.jsessionId;
        const cleanedCsrfToken = rawCsrfToken ? JSON.parse(rawCsrfToken) : null;
        console.log({ dfdf: rawCsrfToken, dfdaa: cleanedCsrfToken });
        resolve(cleanedCsrfToken);
      }
    });
  });
}

function getKeywordsFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("keywords") || "";
}

function getOriginFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("origin") || "FACETED_SEARCH";
}

async function fetchPostsFromAPI(start = 0, count = 3) {
  logger.info('FETCH_POSTS_START', 'Starting LinkedIn posts API fetch', {
    start,
    count,
    timestamp: new Date().toISOString(),
    url: window.location.href
  }, 'topicList.js');

  const keywords = getKeywordsFromUrl();
  const origin = getOriginFromUrl();
  const dynamicQueryParams = buildDynamicQueryParams();
  const secChUaHeader = await getSecChUaHeader();
  const secChUaMobile = getSecChUaMobile();
  const secChUaPlatform = getSecChUaPlatform();
  const xLiLang = getXLiLang();
  const acceptLanguage = getAcceptLanguage();
  const xLiTrackHeader = getXLiTrackHeader();

  logger.debug('FETCH_POSTS_PARAMS', 'API parameters prepared', {
    keywords: keywords.substring(0, 50) + (keywords.length > 50 ? '...' : ''),
    origin,
    dynamicQueryParamsCount: Object.keys(dynamicQueryParams).length,
    hasSecHeaders: !!secChUaHeader
  }, 'topicList.js');

  const variablesObj = {
    start,
    origin,
    query: {
      keywords,
      flagshipSearchIntent: "SEARCH_SRP",
      queryParameters: dynamicQueryParams,
      includeFiltersInResponse: false,
    },
    count,
  };

  const variablesString = `(${Object.entries(variablesObj)
    .map(([k, v]) => `${k}:${serializeValue(v)}`)
    .join(",")})`;

  // ❌ REMOVE THIS LINE - This is causing the over-encoding
  // const encodedVariables = encodeURIComponent(variablesString);

  // ✅ Use raw variables string, only encode spaces in keywords if needed
  const finalVariables = variablesString.replace(/ /g, "%20"); // Only encode spaces

  const apiUrl = `https://www.linkedin.com/voyager/api/graphql?includeWebMetadata=true&variables=${finalVariables}&queryId=voyagerSearchDashClusters.5ba32757c00b31aea747c8bebb92855c`;

  logger.debug('FETCH_POSTS_URL', 'API URL generated', {
    apiUrl: apiUrl.substring(0, 200) + '...',
    variablesLength: variablesString.length,
    finalVariablesLength: finalVariables.length
  }, 'topicList.js');

  const headers = {
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": acceptLanguage,

    "csrf-token": await getCsrfToken(),
    priority: "u=1, i",
    "sec-ch-prefers-color-scheme": "dark",
    "sec-ch-ua": secChUaHeader,
    "sec-ch-ua-mobile": secChUaMobile,
    "sec-ch-ua-platform": secChUaPlatform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-li-lang": xLiLang,
    "x-li-pem-metadata": "Voyager - Content SRP=search-results",
    "x-li-track": xLiTrackHeader,

    "x-restli-protocol-version": "2.0.0",
  };

  try {
    logger.debug('FETCH_POSTS_REQUEST', 'Making LinkedIn API request', {
      method: 'GET',
      hasHeaders: Object.keys(headers).length,
      credentials: 'include'
    }, 'topicList.js');

    const resp = await fetch(apiUrl, {
      method: "GET",
      headers,
      credentials: "include",
      mode: "cors",
    });

    if (!resp.ok) {
      logger.error('FETCH_POSTS_FAILED', 'LinkedIn API fetch posts failed', {
        status: resp.status,
        statusText: resp.statusText,
        url: apiUrl.substring(0, 100) + '...'
      }, 'topicList.js');
      return [];
    }

    const json = await resp.json();
    logger.info('FETCH_POSTS_SUCCESS', 'Posts API response received', {
      hasIncluded: !!json?.included,
      includedLength: json?.included?.length || 0,
      hasData: !!json?.data,
      responseKeys: json ? Object.keys(json) : []
    }, 'topicList.js');

    // Handle both search results and feed data
    let extractedPosts = [];

    // Check if it's search results format (has included array)
    if (json?.included?.length) {
      // Filter for search result posts (EntityResultViewModel type)
      const searchPostElements = json.included.filter(
        (el) =>
          el.$type ===
            "com.linkedin.voyager.dash.search.EntityResultViewModel" &&
          el.trackingUrn &&
          el.summary // Has post content
      );

      logger.info('SEARCH_POSTS_FOUND', 'Search post elements extracted', {
        totalIncluded: json.included.length,
        searchPostElements: searchPostElements.length
      }, 'topicList.js');

      if (searchPostElements.length > 0) {
        extractedPosts = searchPostElements.map((el) => {
          // Extract post ID from trackingUrn (urn:li:activity:XXXXXXXXX)
          const postId = el.trackingUrn.split(":").pop();

          // Extract post content from summary text
          const content = el.summary?.text || "";

          // Extract actor name from title
          const actorName = el.title?.text || "";

          // Extract actor profile URL from actorNavigationUrl
          const actorProfile = el.actorNavigationUrl || "";

          // Build post URL for feed/update page
          const postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${postId}`;

          console.log("Extracted search post data:", {
            postId,
            content,
            actorName,
            actorProfile,
            postUrl,
          });

          return {
            postId,
            content,
            actorName,
            actorProfile,
            postUrl,
            type: "search",
            rawData: el,
          };
        });
      }
    }

    // Check if it's feed format (direct array of feed updates)
    const feedData = Array.isArray(json) ? json : json?.included || [];
    const feedPostElements = feedData.filter(
      (el) => el.$type === "com.linkedin.voyager.dash.feed.Update"
    );

    console.log("Feed post elements found:", feedPostElements.length);

    if (feedPostElements.length > 0) {
      const feedPosts = feedPostElements.map((el) => {
        // Extract post ID from backend URN or share URN
        const backendUrn = el.metadata?.backendUrn || "";
        const shareUrn = el.metadata?.shareUrn || "";
        const postId = backendUrn.split(":").pop() || shareUrn.split(":").pop();

        // Extract post content from commentary
        const content = el.commentary?.text?.text || "";

        // Extract actor name
        const actorName = el.actor?.name?.text || "";

        // Extract actor profile URL
        const actorProfile = el.actor?.navigationContext?.actionTarget || "";

        // Build post URL
        const postUrl = shareUrn
          ? `https://www.linkedin.com/feed/update/${shareUrn}`
          : `https://www.linkedin.com/feed/update/urn:li:activity:${postId}`;

        // Extract hashtags from text attributes
        const hashtags =
          el.commentary?.text?.attributesV2
            ?.filter((attr) => attr.detailData?.hashtag)
            .map((attr) => {
              const hashtagUrn = attr.detailData.hashtag;
              // Extract hashtag name from URN like "urn:li:fsd_hashtag:(work,urn:li:activity:...)"
              const match = hashtagUrn.match(/\(([^,]+),/);
              return match ? match[1] : null;
            })
            .filter(Boolean) || [];

        // Extract timestamp
        const timestamp = el.actor?.subDescription?.text || "";

        // Get social activity counts
        const getSocialCounts = () => {
          // Find corresponding social activity counts
          const socialCountsUrn = shareUrn || `urn:li:ugcPost:${postId}`;
          const socialCounts = feedData.find(
            (item) =>
              item.$type ===
                "com.linkedin.voyager.dash.feed.SocialActivityCounts" &&
              item.urn === socialCountsUrn
          );

          return {
            likes: socialCounts?.numLikes || 0,
            comments: socialCounts?.numComments || 0,
            shares: socialCounts?.numShares || 0,
            reactions: socialCounts?.reactionTypeCounts || [],
          };
        };

        console.log("Extracted feed post data:", {
          postId,
          content: content.substring(0, 100) + "...",
          actorName,
          hashtags,
          socialCounts: getSocialCounts(),
        });

        return {
          postId,
          content,
          actorName,
          actorProfile,
          postUrl,
          hashtags,
          timestamp,
          socialCounts: getSocialCounts(),
          shareUrn,
          backendUrn,
          type: "feed",
          rawData: el,
        };
      });

      extractedPosts = extractedPosts.concat(feedPosts);
    }

    console.log("Total valid posts found:", extractedPosts.length);

    if (extractedPosts.length === 0) {
      console.log("No posts found. Data structure:", {
        isArray: Array.isArray(json),
        hasIncluded: !!json?.included,
        includedLength: json?.included?.length || 0,
        directArrayLength: Array.isArray(json) ? json.length : 0,
        sampleTypes: Array.isArray(json)
          ? json.slice(0, 5).map((item) => item.$type)
          : json?.included?.slice(0, 5).map((item) => item.$type) || [],
      });
    }

    return extractedPosts;
  } catch (error) {
    console.log("Error fetching posts from LinkedIn API:", error);
    return [];
  }

  // Your helper functions remain the same
  function buildDynamicQueryParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const paramKeys = [
      "authorCompany",
      "authorIndustry",
      "authorJobTitle",
      "contentType",
      "datePosted",
      "fromMember",
      "fromOrganization",
      "mentionsMember",
      "mentionsOrganization",
      "postedBy",
      "sortBy",
    ];

    const queryParams = [];
    queryParams.push({ key: "resultType", value: ["CONTENT"] });

    paramKeys.forEach((key) => {
      if (urlParams.has(key)) {
        let value = urlParams.get(key);
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            queryParams.push({ key, value: parsed });
          } else {
            queryParams.push({ key, value: [parsed] });
          }
        } catch (e) {
          value = value.replace(/^"|"$/g, "");
          queryParams.push({ key, value: [value] });
        }
      }
    });

    return queryParams;
  }

  function serializeValue(value) {
    if (Array.isArray(value)) {
      return `List(${value.map(serializeValue).join(",")})`;
    } else if (typeof value === "object" && value !== null) {
      return `(${Object.entries(value)
        .map(([k, v]) => `${k}:${serializeValue(v)}`)
        .join(",")})`;
    } else {
      return String(value); // No quotes for LinkedIn format
    }
  }
}

// Start scanning for posts
async function startScanning() {
  if (!extensionActive || isProcessing) return;
  isProcessing = true;
  try {
    const result = await engageWithFirstScannedPost();
    console.log("engageWithFirstScannedPost completed with result:", result);

    // Don't reschedule if pagination is ongoing
    if (result === "PAGINATION_ONGOING" || isApiPaginating) {
      console.log("Pagination ongoing, not rescheduling startScanning");
      return;
    }
  } catch (error) {
    console.error("startScanning error:", error);
    chrome.runtime.sendMessage({
      action: "DELAYED_FEED_REDIRECT",
      minDelay,
      maxDelay,
      url: await getRandomTopicUrl(),
    });
  } finally {
    isProcessing = false;

    // Don't reschedule if we're in API pagination mode
    if (!isApiPaginating) {
      const delay = getRandomDelay(minDelay, maxDelay);
      const currentUrlSnapshot = window.location.href;
      setTimeout(() => {
        if (extensionActive && window.location.href === currentUrlSnapshot) {
          startScanning();
        }
      }, delay);
    } else {
      console.log("API pagination in progress, not rescheduling startScanning");
    }
  }
}

function checkPromotedPosts(post, className = null) {
  let cName = className ?? SELECTORS.promotedPost[0];
  let postSubTextEls = post.querySelector(className);
  // console.log("postSubTextEls: ", !!postSubTextEls.length);
  if (postSubTextEls) {
    const postSubTextEl = postSubTextEls;
    const postSubText = postSubTextEl.textContent.trim();

    if (postSubText.toLowerCase().includes("promoted")) return true;
  }

  if (!!className) return false;

  return checkPromotedPosts(post, SELECTORS.promotedPost[1]);
}

async function createContactInBackground(contactData) {
  logger.info('CREATE_CONTACT_START', 'Starting contact creation in background', {
    hasContactData: !!contactData,
    contactDataKeys: contactData ? Object.keys(contactData) : [],
    name: contactData?.name,
    email: contactData?.email,
    company: contactData?.company
  }, 'topicList.js');

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "createContact", data: contactData },
      (response) => {
        if (chrome.runtime.lastError) {
          logger.error('CONTACT_CREATE_RUNTIME_ERROR', 'Chrome runtime error during contact creation', {
            error: chrome.runtime.lastError.message,
            contactData
          }, 'topicList.js');
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        logger.debug('CONTACT_CREATE_RESPONSE', 'Background response received', {
          hasResponse: !!response,
          success: response?.success,
          hasData: !!response?.data,
          error: response?.error
        }, 'topicList.js');

        if (response?.success) {
          logger.success('CONTACT_CREATE_SUCCESS', 'Contact created successfully', {
            contactId: response.data?.data?.id || response.data?.data,
            responseData: response.data?.data
          }, 'topicList.js');
          resolve(response.data?.data);
        } else {
          logger.error('CONTACT_CREATE_FAILED', 'Failed to create contact', {
            error: response?.error || 'Unknown error',
            response,
            contactData
          }, 'topicList.js');
          reject(new Error(response?.error || "Failed to create contact"));
        }
      }
    );
  });
}

// Scan for celebration posts
async function scanPosts() {
  console.log("[scanPosts] === START ===");

  const postContainers = document.querySelectorAll(SELECTORS.postList[0]);
  console.log("[scanPosts] Found posts:", postContainers?.length || 0);

  if (!postContainers?.length) {
    showNotification("No posts found on this page.", "warning");
    console.log("[scanPosts] No posts found, exiting");
    return;
  }

  postsScanned += postContainers.length;
  updateStats();
  isProcessing = true;

  for (const post of postContainers) {
    console.log("[scanPosts] Processing post...");

    const initialUrlForPost = window.location.href;
    let redirectUrl = null;

    try {
      const postId = getPostId(post);
      console.log("[scanPosts] Post ID:", postId);

      if (!postId) {
        console.log("[scanPosts] No postId found, skipping");
        continue;
      }
      if (lastProcessedPosts.has(postId)) {
        console.log("[scanPosts] Already processed, skipping:", postId);
        continue;
      }
      lastProcessedPosts.add(postId);
      post.setAttribute("data-auto-commenter-processed", "true");

      if (checkPromotedPosts(post)) {
        console.log("[scanPosts] Promoted post, skipping:", postId);
        continue;
      }

      const postContent = extractPostContent(post);
      console.log(
        "[scanPosts] Extracted content:",
        postContent?.substring(0, 80)
      );

      if (window.location.href !== initialUrlForPost) {
        console.log("[scanPosts] URL changed, stopping");
        break;
      }

      console.log("[scanPosts] Generating comment...");
      const loadingNotification = showNotification(
        "Generating comment...",
        "loading"
      );
      const generatedComment = await generateComment(postContent);
      if (loadingNotification) loadingNotification.closeNotification();
      console.log("[scanPosts] Generated comment:", generatedComment);

      const shouldPostComment =
        !!generatedComment && !generatedComment.includes("NULL");
      console.log("[scanPosts] shouldPostComment =", shouldPostComment);

      const topicEngData = await getFromChromeStorage("topic_eng_data", {});
      console.log("[scanPosts] topicEngData:", topicEngData);

      const engagementTypes = topicEngData?.engagement_types ?? {
        like: true,
        comment: true,
        connect: true,
      };
      console.log("[scanPosts] Engagement types:", engagementTypes);
      console.log("[scanPosts] Individual engagement checks:");
      console.log("[scanPosts] - Like enabled:", engagementTypes.like);
      console.log("[scanPosts] - Comment enabled:", engagementTypes.comment);
      console.log("[scanPosts] - Connect enabled:", engagementTypes.connect);

      if (!topicEngData?.list_id) {
        console.log(
          "[scanPosts] No list_id found, redirecting to random topic"
        );
        redirectUrl = await getRandomTopicUrl();
        break;
      }

      // === Contact creation ===
      let contactId = null;
      try {
        console.log("[scanPosts] Creating contact...");
        const { firstName, lastName } = extractFirstAndLastName(post);
        const mp_linkedinProfile = extractLinkedInProfile(post);
        const avatarUrl = extractAvatarUrl(post);

        const contactData = await createContactInBackground({
          firstName,
          lastName,
          mp_linkedinProfile,
          list_id: topicEngData.list_id,
          avatar: avatarUrl,
        });

        console.log("[scanPosts] Contact created:", contactData);
        contactId = contactData._id;

        updateLocalStorageObject("topic_eng_data", {
          contact_id: contactData._id,
          business_id: contactData.business_id,
          user_profile_url: mp_linkedinProfile,
          current_post_id: postId,
        });
      } catch (err) {
        console.log("[scanPosts] [ERROR] Contact creation failed:", err);
        redirectUrl = await getRandomTopicUrl();
        break;
      }

      // === SEQUENTIAL ENGAGEMENTS ===
      console.log("[scanPosts] Starting sequential engagements...");
      
      // === LIKE ===
      if (engagementTypes.like) {
        console.log("[scanPosts] START LIKE");
        try {
          await handleLikePost(post, contactId);
          console.log("[scanPosts] LIKE SUCCESS");
          await new Promise((res) =>
            setTimeout(res, getRandomDelay(5000, 10000))
          );
        } catch (err) {
          console.log("[scanPosts] [ERROR] Like failed:", err);
        }
        console.log("[scanPosts] END LIKE");
      }

      // === COMMENT ===
      if (engagementTypes.comment && shouldPostComment) {
        console.log("[scanPosts] START COMMENT");
        try {
          await new Promise((res) =>
            setTimeout(res, getRandomDelay(8000, 15000))
          );
          await postComment(post, generatedComment, contactId);
          console.log("[scanPosts] COMMENT SUCCESS");
          await new Promise((res) =>
            setTimeout(res, getRandomDelay(5000, 10000))
          );
        } catch (err) {
          console.log("[scanPosts] [ERROR] Comment failed:", err);
        }
        console.log("[scanPosts] END COMMENT");
      }

      // === CONNECT / PROFILE VISIT ===
      if (engagementTypes.connect) {
        logger.info('PROFILE_VISIT_START', 'Starting profile visit process', {
          postId: getPostId(post),
          posterName: getPosterName(post),
          engagementTypes
        }, 'topicList.js');

        try {
          const posterProfileUrl = extractLinkedInProfile(post);
          
          logger.debug('POSTER_PROFILE_EXTRACTION', 'Extracted poster profile URL', {
            posterProfileUrl,
            hasProfileUrl: !!posterProfileUrl,
            postId: getPostId(post),
            posterName: getPosterName(post)
          }, 'topicList.js');

          if (posterProfileUrl) {
            if (posterProfileUrl.includes("/in/")) {
              // Only set redirect if it's a user profile
              logger.success('VALID_USER_PROFILE', 'Valid user profile detected for redirect', {
                posterProfileUrl,
                postId: getPostId(post),
                posterName: getPosterName(post)
              }, 'topicList.js');

              updateLocalStorageObject("topic_eng_data", { posterProfileUrl });
              redirectUrl = posterProfileUrl;
              
              logger.info('PROFILE_REDIRECT_SET', 'Redirect set to user profile', {
                redirectUrl,
                postId: getPostId(post)
              }, 'topicList.js');

            } else {
              // Fallback to random topic
              logger.warn('NON_USER_PROFILE', 'Non-user profile detected (company/page)', {
                posterProfileUrl,
                postId: getPostId(post),
                profileType: 'company/page'
              }, 'topicList.js');

              redirectUrl = await getRandomTopicUrl();
              
              logger.info('FALLBACK_REDIRECT', 'Redirecting to random topic due to non-user profile', {
                originalProfileUrl: posterProfileUrl,
                redirectUrl,
                postId: getPostId(post)
              }, 'topicList.js');
            }
          } else {
            // No profile found, fallback
            logger.warn('NO_PROFILE_EXTRACTED', 'No profile URL extracted from post', {
              postId: getPostId(post),
              posterName: getPosterName(post)
            }, 'topicList.js');

            redirectUrl = await getRandomTopicUrl();
            
            logger.info('NO_PROFILE_FALLBACK', 'Redirecting to random topic due to no profile', {
              redirectUrl,
              postId: getPostId(post)
            }, 'topicList.js');
          }
        } catch (err) {
          logger.error('PROFILE_VISIT_ERROR', 'Profile visit failed', {
            error: err.message,
            stack: err.stack,
            postId: getPostId(post)
          }, 'topicList.js');

          redirectUrl = await getRandomTopicUrl();
        }
        console.log("[scanPosts] END PROFILE VISIT");
      } else {
        console.log("[scanPosts] SKIPPING PROFILE VISIT - Connect engagement is DISABLED");
      }

      // === Redirect fallback ===
      if (!redirectUrl) {
        console.log("[scanPosts] No redirect URL set, checking engagement types...");
        
        // If connect engagement was enabled but no redirectUrl was set, 
        // something went wrong - set a fallback
        if (engagementTypes.connect) {
          console.log("[scanPosts] Connect engagement was enabled but no redirect URL, using fallback");
          redirectUrl = await getRandomTopicUrl();
        } else {
          console.log("[scanPosts] No connect engagement enabled, using standard fallback");
          redirectUrl = await getRandomTopicUrl();
        }
      }
      
      console.log("[scanPosts] Final redirect URL:", redirectUrl);
      
      // === ENGAGEMENT SUMMARY ===
      console.log("[scanPosts] ENGAGEMENT SUMMARY:");
      console.log(`[scanPosts] - Like: ${engagementTypes.like ? '✅ ENABLED' : '❌ DISABLED'}`);
      console.log(`[scanPosts] - Comment: ${engagementTypes.comment ? '✅ ENABLED' : '❌ DISABLED'} ${shouldPostComment ? '(Comment generated)' : '(No comment/failed)'}`);
      console.log(`[scanPosts] - Connect: ${engagementTypes.connect ? '✅ ENABLED' : '❌ DISABLED'} ${redirectUrl && redirectUrl.includes('/in/') ? '(Profile redirect)' : '(Random topic redirect)'}`);
      console.log("[scanPosts] ===================");
    } catch (error) {
      console.log("[scanPosts] [ERROR] General post error:", error);
      redirectUrl = await getRandomTopicUrl();
    }

    if (redirectUrl) {
      console.log("[scanPosts] Sending redirect to:", redirectUrl);
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: redirectUrl,
      });
    }

    console.log("[scanPosts] === END (1 post processed) ===");
    break;
  }

  chrome.storage.local.set({ postsScanned: postsScanned });
}

// Extract post content
function extractPostContent(post) {
  // Try to find the main text content
  const contentElement =
    post.querySelector(SELECTORS.postContent[0]) ||
    post.querySelector(SELECTORS.postContent[1]);
  // const contentElement = post.querySelector('.feed-shared-update-v2__description-text') ||
  //                         post.querySelector('.feed-shared-text');

  if (contentElement) {
    return contentElement.textContent.trim();
  }

  // Fallback
  return post.textContent.trim();
}

// Generate comment using GPT or custom logic
async function generateComment(postContent) {
  return await generateGPTComment(postContent);
}

// Generate comment using GPT API
async function generateGPTComment(postContent) {
  try {
    const max_words = commentLength;
    const prompt = `Generate comment for post: "${postContent}"`;
    const finalSystemPrompt = [systemPrompt.trim(), userPrompt.trim()].join(
      "\n"
    );
    const systemPrompts = finalSystemPrompt.replace("{{MAX_WORDS}}", max_words);

    const body = JSON.stringify({
      model: "llama3.1:latest",
      messages: [
        {
          role: "system",
          content: systemPrompts,
          // content: `You are a professional comment generator. Generate a concise, professional, and personalized comment based on the user's post and its top comments. Follow these rules: Match the topic and tone without deviation; be supportive, non-aggressive, and use direct address ('you'/'your'); keep the comment within ${max_words} words; reference specific details from the post/comments; do not ask questions; synthesize ideas uniquely without copying top comments; if unable to generate properly, return NULL. Output only the comment text or NULL—no explanations, markdown, or extra text.  Example Output: Good to hear you've learned the MERN stack. Its simplicity and demand make it a great choice—best of luck with the interviews!`,
          // `You are a professional comment generator. You need to generate a concise, professional, and personalized comment based on the user's post and its top comments. Follow these rules: 1. Relevance: Match the topic and tone of the post and comments. Do not deviate. 2. Tone: Be supportive, non-aggressive, and avoid argumentative/questioning language. Always use direct address ('you/your'). 3. Conciseness: ${sentanceLength} sentences max. Avoid generic phrases (e.g., 'Great post!') 4. Specificity: Reference details from the post/comments (e.g., skills, achievements, goals). 5. No Questions: Do not ask for clarifications, opinions, or further details. 6. Originality: Do not repeat top comments verbatim. Synthesize ideas uniquely. 7. Output: Return only the comment text. No explanations, markdown, or extra text. Example Output: Good to hear you've learned the MERN stack. Its simplicity and demand make it a great choice—best of luck with the interviews!`,
        },
        { role: "user", content: prompt },
      ],
      options: {
        // temperature: 0.1,
        max_token: MaxTokens[commentLength],
        repeat_penalty: 1.2,
        // top_k: 40,
        // top_p: 0.3,
      },
    });

    const serverUrl = `${APIURL}/ai/chat`;

    const data = await callApi({
      action: "API_POST_GENERATE_COMMENT",
      url: serverUrl,
      method: "POST",
      body,
    });

    console.log("data: ", data);

    if (data.error) {
      console.error("GPT API error:", data.error);
      return generateCustomComment(postContent, topComments);
    }

    return data.data.data;
  } catch (error) {
    console.error("Error calling GPT API:", error);
    return generateCustomComment(postContent, topComments);
  }
}

async function handleLikePost(post, contact_id) {
  try {
    logger.info('LIKE_POST_START', 'Starting post like action', {
      hasPost: !!post,
      contactId: contact_id,
      postId: getPostId(post),
      postUrl: getPostUrl(post),
      posterName: getPosterName(post)
    }, 'topicList.js');

    const likeButton =
      post.querySelector(SELECTORS.likeButton[0]) ||
      post.querySelector(SELECTORS.likeButton[1]);
      
    if (!likeButton) {
      logger.warn('LIKE_BUTTON_NOT_FOUND', 'Like button not found for post', {
        postId: getPostId(post),
        selectors: SELECTORS.likeButton
      }, 'topicList.js');
      return;
    }

    logger.debug('LIKE_BUTTON_FOUND', 'Like button found, simulating click', {
      postId: getPostId(post),
      buttonText: likeButton.textContent?.trim()
    }, 'topicList.js');

    simulateMouseClick(likeButton);
    await new Promise((resolve) =>
      setTimeout(resolve, getRandomDelay(1000, 3000))
    );

    // Get stored data from Chrome storage using the utility function
    const topicEngData = await getFromChromeStorage("topic_eng_data", {});
    const contactTypeId = contact_id || topicEngData.contact_id;
    
    logger.debug('LIKE_POST_DATA', 'Topic engagement data retrieved', {
      hasTopicEngData: !!topicEngData,
      businessId: topicEngData.business_id,
      topicId: topicEngData.topic_id,
      contactTypeId,
      hasLastActivityId: !!topicEngData?.last_activity_id
    }, 'topicList.js');

    // Validate that we have the required data
    if (!topicEngData.business_id || !topicEngData.topic_id || !contactTypeId) {
      logger.error('LIKE_POST_MISSING_DATA', 'Missing required topic engagement data', {
        hasBusinessId: !!topicEngData.business_id,
        hasTopicId: !!topicEngData.topic_id,
        hasContactId: !!contactTypeId,
        topicEngData,
        postId: getPostId(post)
      }, 'topicList.js');
      return;
    }

    const activityPayload = {
      activityId: topicEngData?.last_activity_id,
      businessId: topicEngData.business_id,
      engagement_type: "like",
      segmentId: topicEngData.topic_id,
      customerId: contactTypeId,
      posterName: getPosterName(post),
      posterProfile: getPosterProfile(post),
      postUrl: getPostUrl(post),
      postId: getPostId(post),
      isAutoPost: autoPostEnabled,
    };

    logger.activityAPI.start('Making like activity API call', {
      engagementType: 'like',
      postId: getPostId(post),
      businessId: topicEngData.business_id,
      customerId: contactTypeId,
      posterName: getPosterName(post),
      isAutoPost: autoPostEnabled
    });

    // Make activity API call
    await chrome.runtime.sendMessage({
      action: "MAKE_ACTIVITY_API_CALL",
      payload: activityPayload,
    });

    postsLiked++;
    updateStats();
    
    logger.success('LIKE_POST_SUCCESS', 'Post liked successfully', {
      postId: getPostId(post),
      postsLiked,
      posterName: getPosterName(post),
      contactTypeId
    }, 'topicList.js');

  } catch (e) {
    logger.error('LIKE_POST_ERROR', 'Error liking the post', {
      error: e.message,
      stack: e.stack,
      postId: getPostId(post),
      contactId: contact_id
    }, 'topicList.js');
  }
}

function addCommentButtonListner(post, commentInput, submitButton) {
  if (
    commentInput &&
    submitButton &&
    !submitButton.hasAttribute("data-mp-listener-attached")
  ) {
    console.log(
      "Attaching listener to submit button for post:",
      getPostId(post)
    );

    console.log(submitButton);

    submitButton.addEventListener(
      "click",
      async (event) => {
        // Check if the input field still exists (robustness)
        const currentCommentInput =
          post.querySelector(SELECTORS.commentInput[0]) ||
          post.querySelector(SELECTORS.commentInput[1]);

        if (currentCommentInput) {
          const commentText = currentCommentInput.textContent.trim();

          if (commentText) {
            console.log(
              `User clicked submit for post ${getPostId(post)}. Comment:`,
              commentText
            );

            // --- YOUR LOGIC HERE ---
            // - Send the commentText to background script
            // - Store it using tracker.addEngagement (maybe a different type?)
            // - Perform analysis, etc.
            // -----------------------

            // Get stored data from Chrome storage using the utility function
            const topicEngData = await getFromChromeStorage(
              "topic_eng_data",
              {}
            );

            // Validate that we have the required data
            if (
              !topicEngData.business_id ||
              !topicEngData.topic_id ||
              !topicEngData.contact_id
            ) {
              logger.error('COMMENT_ACTIVITY_MISSING_DATA', 'Missing required topic engagement data for comment activity', {
                hasBusinessId: !!topicEngData.business_id,
                hasTopicId: !!topicEngData.topic_id,
                hasContactId: !!topicEngData.contact_id,
                topicEngData,
                postId: getPostId(post)
              }, 'topicList.js');
              return;
            }

            const commentActivityPayload = {
              activityId: topicEngData?.last_activity_id,
              isCreate: topicEngData?.engagement_types
                ? !topicEngData.engagement_types.like
                : true,
              businessId: topicEngData?.business_id,
              engagement_type: "comment",
              segmentId: topicEngData.topic_id,
              customerId: topicEngData.contact_id,
              posterName: getPosterName(post),
              posterProfile: getPosterProfile(post),
              postUrl: getPostUrl(post),
              postId: getPostId(post),
              isAutoPost: true,
              comment: commentText,
            };

            logger.activityAPI.start('Making comment activity API call', {
              engagementType: 'comment',
              postId: getPostId(post),
              businessId: topicEngData.business_id,
              customerId: topicEngData.contact_id,
              commentLength: commentText ? commentText.length : 0,
              commentPreview: commentText ? commentText.substring(0, 50) + '...' : 'No comment',
              posterName: getPosterName(post),
              isAutoPost: true,
              hasLastActivityId: !!topicEngData?.last_activity_id
            });

            await chrome.runtime.sendMessage({
              action: "MAKE_ACTIVITY_API_CALL",
              payload: commentActivityPayload,
            });

            commentsPosted++;
            updateStats();

            logger.activityAPI.success('Comment activity API call completed', {
              postId: getPostId(post),
              commentsPosted,
              commentLength: commentText.length,
              customerId: topicEngData.contact_id
            });

            // await getCommentUrl(post);
          } else {
            console.log("Submit clicked, but comment box is empty.");
          }
        } else {
          console.warn(
            "Could not find comment input field when submit was clicked."
          );
        }
      },
      true
    ); // Use capture phase if needed, but bubbling (false/default) is usually fine

    // Mark the button so we don't attach multiple listeners
    submitButton.setAttribute("data-mp-listener-attached", "true");
  }
}

async function postComment(post, comment, contact_id) {
  try {
    logger.info('POST_COMMENT_START', 'Starting comment posting process', {
      hasPost: !!post,
      commentLength: comment ? comment.length : 0,
      commentPreview: comment ? comment.substring(0, 50) + '...' : 'No comment',
      contactId: contact_id,
      postId: getPostId(post),
      autoPostEnabled
    }, 'topicList.js');

    // Find comment input field
    const commentButton =
      post.querySelector(SELECTORS.commentButton[0]) ||
      post.querySelector(SELECTORS.commentButton[1]);

    if (!commentButton) {
      logger.debug('COMMENT_BUTTON_NOT_FOUND', 'Comment button not found, trying to open comment section', {
        postId: getPostId(post),
        selectors: SELECTORS.commentButton
      }, 'topicList.js');

      // Try to open comment section first
      const openCommentButton = post.querySelector(
        SELECTORS.openCommentButton[1]
      );
      if (openCommentButton) {
        logger.debug('OPENING_COMMENT_SECTION', 'Opening comment section', {
          postId: getPostId(post)
        }, 'topicList.js');

        simulateMouseClick(openCommentButton);

        // Wait for comment section to load
        await new Promise((resolve) =>
          setTimeout(resolve, getRandomDelay(1000, 3000))
        );
      }
    }

    // Clean comment text
    if (comment[0] === '"') {
      comment = comment.slice(1, -1);
    } else if (comment[comment.length - 1] === '"') {
      comment = comment.slice(0, -1);
    } else if (comment[0] === "'") {
      comment = comment.slice(1, -1);
    } else if (comment[comment.length - 1] === "'") {
      comment = comment.slice(0, -1);
    }

    logger.debug('COMMENT_CLEANED', 'Comment text cleaned', {
      finalCommentLength: comment.length,
      finalComment: comment.substring(0, 100) + (comment.length > 100 ? '...' : '')
    }, 'topicList.js');

    // Find comment input after opening comments
    const commentInput =
      post.querySelector(SELECTORS.commentInput[0]) ||
      post.querySelector(SELECTORS.commentInput[1]);

    if (!commentInput) {
      logger.error('COMMENT_INPUT_NOT_FOUND', 'Comment input not found', {
        postId: getPostId(post),
        selectors: SELECTORS.commentInput
      }, 'topicList.js');
      throw new Error("Comment input or submit button not found");
    }

    logger.debug('COMMENT_INPUT_FOUND', 'Comment input found, typing comment', {
      postId: getPostId(post),
      inputType: commentInput.tagName
    }, 'topicList.js');

    // Type comment with human-like delays
    await setCommentInputValue(commentInput, comment);

    let submitButton = null;
    const submitButtonSelectors = SELECTORS.submitButton;

    // Ensure submitButtonSelectors is a valid array before proceeding
    if (
      submitButtonSelectors &&
      Array.isArray(submitButtonSelectors) &&
      submitButtonSelectors.length > 0
    ) {
      const pollingTimeout = 5000; // Max time to wait for the button (5 seconds)
      const pollInterval = 500; // Check every 500ms
      let elapsedTime = 0;

      logger.debug('SUBMIT_BUTTON_POLLING', 'Polling for submit button', {
        postId: getPostId(post),
        selectors: submitButtonSelectors,
        pollingTimeout,
        pollInterval
      }, 'topicList.js');

      // Poll for the submit button to appear and be enabled
      while (!submitButton && elapsedTime < pollingTimeout) {
        for (const selector of submitButtonSelectors) {
          const button = post.querySelector(selector);
          // Check if button exists and is not disabled (which often means it's ready)
          if (
            button &&
            !button.disabled &&
            button.getAttribute("aria-disabled") !== "true"
          ) {
            submitButton = button;
            break; // Exit inner loop (selectors) once a suitable button is found
          }
        }
        if (submitButton) break; // Exit outer loop (polling) if button is found

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        elapsedTime += pollInterval;
      }
    }

    if (!submitButton) {
      logger.error('SUBMIT_BUTTON_NOT_FOUND', 'Submit button not found or not enabled after polling', {
        postId: getPostId(post),
        selectors: submitButtonSelectors,
        elapsedTime: pollingTimeout
      }, 'topicList.js');
      throw new Error(
        "Comment submit button not found or not enabled after polling"
      );
    }

    logger.debug('SUBMIT_BUTTON_FOUND', 'Submit button found and ready', {
      postId: getPostId(post),
      buttonText: submitButton.textContent?.trim(),
      isDisabled: submitButton.disabled,
      ariaDisabled: submitButton.getAttribute("aria-disabled")
    }, 'topicList.js');

    // Short delay before submitting
    await new Promise(
      (resolve) => setTimeout(resolve, getRandomDelay(500, 1500)) // Adjusted delay, as setCommentInputValue now has a small internal delay
    );

    addCommentButtonListner(post, commentInput, submitButton);

    // Check button state before attempting to click, especially for auto-post
    if (
      autoPostEnabled &&
      (submitButton.disabled ||
        submitButton.getAttribute("aria-disabled") === "true")
    ) {
      logger.warn('SUBMIT_BUTTON_DISABLED', 'Submit button is disabled before auto-post attempt', {
        postId: getPostId(post),
        disabled: submitButton.disabled,
        ariaDisabled: submitButton.getAttribute("aria-disabled")
      }, 'topicList.js');
    }

    if (autoPostEnabled) {
      logger.info('AUTO_POSTING_COMMENT', 'Auto-posting comment', {
        postId: getPostId(post),
        commentLength: comment.length
      }, 'topicList.js');
      // Click submit button
      simulateMouseClick(submitButton);
    }

    // Set next engagement time after successful comment
    setNextEngagementTime(minDelay, maxDelay);
    
    logger.success('POST_COMMENT_SUCCESS', 'Comment posted successfully', {
      postId: getPostId(post),
      commentLength: comment.length,
      autoPosted: autoPostEnabled,
      contactId: contact_id
    }, 'topicList.js');

    return true;
  } catch (error) {
    logger.error('POST_COMMENT_ERROR', 'Error posting comment', {
      error: error.message,
      stack: error.stack,
      postId: getPostId(post),
      commentLength: comment ? comment.length : 0,
      contactId: contact_id
    }, 'topicList.js');
    return false;
  }
}

// Update stats in storage

// Helper function to check if post is already engaged via API
async function checkIfPostEngaged(postId) {
  logger.info('CHECK_POST_ENGAGED', 'Checking if post is already engaged', {
    postId,
    timestamp: new Date().toISOString()
  }, 'topicList.js');

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "CHECK_POST_ENGAGEMENT",
        postId: postId,
      },
      (response) => {
        logger.debug('ENGAGEMENT_CHECK_RESPONSE', 'Background response received', {
          postId,
          hasResponse: !!response,
          hasData: !!response?.data,
          dataError: response?.data?.error
        }, 'topicList.js');

        // Check response.data.error to determine engagement status
        if (response && response.data) {
          if (response.data.error === false) {
            logger.info('POST_NOT_ENGAGED', 'Post is not engaged (can proceed)', {
              postId
            }, 'topicList.js');
            resolve(false); // Not engaged when error is false
          } else if (response.data.error === true) {
            logger.warn('POST_ALREADY_ENGAGED', 'Post is already engaged (skip)', {
              postId
            }, 'topicList.js');
            resolve(true); // Engaged when error is true
          } else {
            logger.warn('ENGAGEMENT_STATUS_UNDEFINED', 'Engagement status undefined, defaulting to not engaged', {
              postId,
              errorValue: response.data.error
            }, 'topicList.js');
            resolve(false); // Default to not engaged if error property is undefined
          }
        } else {
          logger.warn('NO_ENGAGEMENT_DATA', 'No engagement data received, defaulting to not engaged', {
            postId,
            response
          }, 'topicList.js');
          resolve(false); // Default to not engaged if no data
        }
      }
    );
  });
}

async function checkPostRelevanceAPIpost(postContent) {
  try {
    logger.chatGPT.start('Starting post relevance check', {
      postContentLength: postContent ? postContent.length : 0,
      postPreview: postContent ? postContent.substring(0, 100) + '...' : 'No content',
      timestamp: new Date().toISOString()
    });

    const topicEngData = await getFromChromeStorage("topic_eng_data", {});
    if (!topicEngData?.goal_prompt) {
      logger.warn('NO_GOAL_PROMPT', 'No goal prompt found in topic engagement data', {
        hasTopicEngData: !!topicEngData,
        topicEngDataKeys: topicEngData ? Object.keys(topicEngData) : []
      }, 'topicList.js');
      return null;
    }

    const userPrompt = `BUSINESS GOAL: ${topicEngData?.goal_prompt}\nLINKEDIN POST: ${postContent}`;
    const body = JSON.stringify({
      model: "llama3.1:latest",
      messages: [
        { role: "system", content: topicSystemPrompt },
        { role: "user", content: userPrompt },
      ],
      options: { max_token: 100, repeat_penalty: 1.2, temperature: 0.7 },
    });

    logger.info('RELEVANCE_API_REQUEST', 'Making relevance API request', {
      goalPromptLength: topicEngData.goal_prompt.length,
      userPromptLength: userPrompt.length,
      bodySize: body.length,
      model: 'llama3.1:latest'
    }, 'topicList.js');

    const serverUrl = `${APIURL}/ai/chat`;
    const data = await callApi({
      action: "API_POST_GENERATE_MESSAGE",
      url: serverUrl,
      method: "POST",
      body,
    });

    const relevanceResult = data?.data?.data || null;
    
    logger.chatGPT.success('Post relevance check completed', {
      hasResult: !!relevanceResult,
      resultLength: relevanceResult ? relevanceResult.length : 0,
      result: relevanceResult ? relevanceResult.substring(0, 200) + '...' : 'No result',
      serverUrl
    });

    return relevanceResult;
  } catch (error) {
    logger.chatGPT.error('Error checking post relevance', {
      error: error.message,
      stack: error.stack,
      postContentLength: postContent ? postContent.length : 0
    });
    return null;
  }
}
async function engageWithFirstScannedPost() {
  console.log(
    "[engageWithFirstScannedPost] === START === apiPageStart:",
    apiPageStart
  );

  if (
    postsLiked >= dailyLimit ||
    commentsPosted >= dailyLimit ||
    connectionSent >= dailyLimit
  ) {
    console.log("[engageWithFirstScannedPost] Daily limit reached");
    return "DAILY_LIMIT_REACHED";
  }

  if (window.__mp_engaged_specific_post) {
    console.log("[engageWithFirstScannedPost] Already processing, exiting");
    return "ALREADY_PROCESSING";
  }

  window.__mp_engaged_specific_post = true;
  console.log("[engageWithFirstScannedPost] Flag set, proceeding");

  SELECTORS = await getSelectors();
  console.log("[engageWithFirstScannedPost] SELECTORS loaded:", SELECTORS);

  if (!SELECTORS) {
    console.log("[engageWithFirstScannedPost] No SELECTORS found, aborting");
    return "SELECTORS_FAILED";
  }

  if (window.location.pathname?.startsWith("/search/results/content")) {
    console.log("[engageWithFirstScannedPost] On search results page");

    try {
      if (apiPageStart === 0) {
        console.log(
          "[engageWithFirstScannedPost] Waiting before engagement..."
        );
        await waitForNextEngagement(minDelay, maxDelay);
      }

      const posts = await fetchPostsFromAPI(apiPageStart);
      console.log("[engageWithFirstScannedPost] Posts fetched:", posts?.length);

      const newPosts = posts.filter((p) => !processedPostIds.has(p.postId));
      console.log(
        "[engageWithFirstScannedPost] New posts after filtering:",
        newPosts.length
      );

      for (const post of newPosts) {
        console.log(
          "[engageWithFirstScannedPost] Processing postId:",
          post.postId
        );
        processedPostIds.add(post.postId);

        const engaged = await checkIfPostEngaged(
          "urn:li:activity:" + post.postId
        );
        console.log("[engageWithFirstScannedPost] Engagement status:", engaged);

        if (!engaged) {
          console.log("[engageWithFirstScannedPost] Already engaged, skipping");
          continue;
        }

        const relevanceResult = await checkPostRelevanceAPIpost(post.content);
        console.log(
          "[engageWithFirstScannedPost] Relevance result:",
          relevanceResult
        );

        if (String(relevanceResult).toLowerCase().includes("relevant")) {
          console.log(
            "[engageWithFirstScannedPost] Found relevant post:",
            post.postId
          );
          window.location.href = `https://www.linkedin.com/feed/update/urn:li:activity:${post.postId}`;
          return "POST_FOUND";
        }
      }
    } catch (e) {
      console.log(
        "[engageWithFirstScannedPost] [ERROR] API processing failed:",
        e
      );
    }
  }

  if (window.location.pathname.startsWith("/feed/update/")) {
    console.log("[engageWithFirstScannedPost] On individual post page");
    try {
      await scanPosts();
      return "POST_PAGE_PROCESSED";
    } catch (e) {
      console.log("[engageWithFirstScannedPost] [ERROR] scanPosts failed:", e);
      return "POST_ENGAGEMENT_ERROR";
    }
  }

  console.log("[engageWithFirstScannedPost] No matching page type, exiting");
  return "NO_ACTION_TAKEN";
}

// Initial load
function reinitialize() {
  // Clear any existing timeout
  if (initializationTimeout) {
    clearTimeout(initializationTimeout);
  }

  // Only reinitialize if URL actually changed
  if (currentUrl !== window.location.href) {
    console.log(`URL changed from ${currentUrl} to ${window.location.href}`);
    isInitialized = false;

    // Debounce the initialization to prevent rapid calls
    initializationTimeout = setTimeout(() => {
      if (shouldInitialize()) {
        initialize();
      }
    }, 500); // Increased delay to 500ms
  }
}

function shouldInitialize() {
  // Check if we're on a relevant LinkedIn page
  const isLinkedIn = window.location.href.includes("linkedin.com");
  const isFeed =
    window.location.href.includes("feed") ||
    window.location.pathname.startsWith("/feed/update/");
  const isSearchResults = window.location.pathname.startsWith(
    "/search/results/content"
  );

  console.log("Should initialize check:", {
    isLinkedIn,
    isFeed,
    isSearchResults,
  });
  return isLinkedIn && (isFeed || isSearchResults);
}

function updateStats() {
  chrome.storage.local.set({
    commentsPosted: commentsPosted,

    postsLiked: postsLiked,
  });
}
// Initial load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

// Handle SPA navigation with throttling
let observerTimeout = null;
const observer = new MutationObserver(() => {
  // Throttle the observer to prevent excessive calls
  if (observerTimeout) return;

  observerTimeout = setTimeout(() => {
    reinitialize();
    observerTimeout = null;
  }, 300); // 300ms throttle
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also listen for navigation events as backup
window.addEventListener("popstate", reinitialize);
