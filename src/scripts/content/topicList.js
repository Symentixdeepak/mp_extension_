const tracker = require("../../utils/engagement");
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
              // Update local storage with the topic ID
              updateLocalStorageObject("topic_eng_data", {
                topic_id: managedTopic._id,
                goal_prompt: managedTopic.goal_prompt,
                list_id: managedTopic.segment_id,
                business_id: managedTopic.business_id,
              });
              // Instead of updateLocalStorageObject calls, use chrome.storage.local.set
              chrome.storage.local.set(
                {
                  selected_workspace: managedTopic?.business_id,
                  topic_prompt: managedTopic?.prompt,
                },
                () => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "Chrome storage error:",
                      chrome.runtime.lastError
                    );
                  } else {
                    console.log(
                      "✅ Workspace and topic prompt saved successfully"
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
  console.log("Fetching posts from API...", start, count);
  const keywords = getKeywordsFromUrl();
  const origin = getOriginFromUrl();
  const dynamicQueryParams = buildDynamicQueryParams();

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

  console.log("Generated URL:", apiUrl); // Debug log to verify

  console.log("Generated variables string:", variablesString); // Debug log
  console.log("API URL:", apiUrl); // Debug log

  const headers = {
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "en-US,en;q=0.9",
    "csrf-token": await getCsrfToken(),
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
  };

  try {
    const resp = await fetch(apiUrl, {
      method: "GET",
      headers,
      credentials: "include",
      mode: "cors",
    });

    if (!resp.ok) {
      console.log(
        "LinkedIn API fetch posts failed:",
        resp.status,
        resp.statusText
      );
      return [];
    }

    const json = await resp.json();
    console.log("Total posts fetched:", json);
    if (!json?.included?.length) return [];

    // Filter for actual post data (EntityResultViewModel type)
    const postElements = json?.included?.filter(
      (el) =>
        el.$type === "com.linkedin.voyager.dash.search.EntityResultViewModel" &&
        el.trackingUrn &&
        el.summary // Has post content
    );
    console.log("Filtered post elements:", postElements);
    return postElements.map((el) => {
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

      console.log("Extracted post data:", {
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
        rawData: el,
      };
    });
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
  console.log("Creating contact in background with data:", contactData);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "createContact", data: contactData },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Chrome runtime error:",
            chrome.runtime.lastError.message
          );
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        console.log("Response from background:", response);
        if (response?.success) {
          resolve(response.data?.data);
        } else {
          reject(new Error(response?.error || "Failed to create contact"));
        }
      }
    );
  });
}

// Scan for celebration posts
// Scan for celebration posts
async function scanPosts() {
  // Select all posts on the feed
  const postContainers = document.querySelectorAll(SELECTORS.postList[0]);
  if (postContainers?.length === 0) {
    showNotification("No posts found in this page.", "warning");
    return;
  }

  postsScanned += postContainers.length;
  updateStats();

  let engagedPosts = 0;
  let shouldRefresh = true;
  isProcessing = true;

  for (const post of postContainers) {
    const initialUrlForPost = window.location.href;
    let loadingNotification;

    try {
      const postId = getPostId(post);
      if (!postId) continue;

      if (lastProcessedPosts.has(postId)) {
        continue;
      }
      lastProcessedPosts.add(postId);

      // Mark post as processed (optional)
      post.setAttribute("data-auto-commenter-processed", "true");

      const commentButton =
        post.querySelector(SELECTORS.commentButton[0]) ||
        post.querySelector(SELECTORS.commentButton[1]);

      if (commentButton?.hasAttribute("disabled")) continue;

      const isPromoted = checkPromotedPosts(post);
      if (isPromoted) continue;

      const postContent = extractPostContent(post);

      if (window.location.href !== initialUrlForPost) {
        console.log(
          `URL changed before starting generation for post ${postId}. Aborting this post.`
        );
        shouldRefresh = false;
        break;
      }

      loadingNotification = showNotification(
        "Generating comment... ",
        "loading"
      );

      const generatedComment = await generateComment(postContent);

      if (window.location.href !== initialUrlForPost) {
        console.log(
          `URL changed during comment generation for post ${postId}. Aborting.`
        );
        if (loadingNotification) loadingNotification.closeNotification();
        break;
      }

      if (loadingNotification) loadingNotification.closeNotification();

      // Determine if comment is valid
      let shouldPostComment = true;
      if (!generatedComment || generatedComment.includes("NULL")) {
        showNotification(
          "Failed to generate comment, but continuing with engagement.",
          "warning"
        );
        shouldPostComment = false;
      } else {
        showNotification("Comment generated!", "success");
      }

      // Extract contact info before engagement
      const { firstName, lastName } = extractFirstAndLastName(post);
      const mp_linkedinProfile = extractLinkedInProfile(post);
      const avatarUrl = extractAvatarUrl(post);

      const topicEngData = await getFromChromeStorage("topic_eng_data", {});

      if (!topicEngData?.list_id) {
        // If no topic engagement data, skip this post or handle as needed
        return;
      }

      let contactCreated = false;
      let contactData;

      try {
        contactData = await createContactInBackground({
          firstName,
          lastName,
          mp_linkedinProfile,
          list_id: topicEngData.list_id,
          avatar: avatarUrl,
        });

        contactCreated = true;
        console.log("Contact created successfully:", contactData);

        updateLocalStorageObject("topic_eng_data", {
          contact_id: contactData.id || contactData._id,
          business_id: contactData.business_id,
          user_profile_url: mp_linkedinProfile,
          current_post_id: postId,
        });
      } catch (contactError) {
        console.log("Failed to create contact:", contactError);
        showNotification(
          "Failed to create contact. Redirecting to random topic.",
          "error"
        );

        chrome.runtime.sendMessage({
          action: "DELAYED_FEED_REDIRECT",
          minDelay,
          maxDelay,
          url: await getRandomTopicUrl(),
        });

        // Skip this post and continue with others
        continue;
      }

      // Handle Like - always attempt if enabled
      let likeSuccess = false;
      if (likePostEnabled) {
        try {
          await handleLikePost(post, contactData._id);
          likeSuccess = true;
        } catch (likeError) {
          console.log("Failed to like post:", likeError);
          likeSuccess = false;
        }
      } else {
        likeSuccess = true; // Consider success if liking disabled
      }

      // Small delay for natural behavior
      await new Promise((resolve) =>
        setTimeout(resolve, getRandomDelay(6000, 12000))
      );

      // Handle comment posting only if shouldPostComment is true
      let commentSuccess = false;
      if (shouldPostComment) {
        try {
          await postComment(post, generatedComment, contactData.id);
          commentSuccess = true;

          await new Promise((resolve) =>
            setTimeout(resolve, getRandomDelay(2000, 3000))
          );
        } catch (commentError) {
          console.log("Failed to post comment:", commentError);
          commentSuccess = false;
        }
      } else {
        commentSuccess = false;
      }

      engagedPosts++;

      // Proceed with redirect to a random topic URL (or customize as needed)
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(),
      });
    } catch (error) {
      // General error handling
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(),
      });
      console.log("Error generating or posting comment:", error);
      showNotification("Error generating comment", "error");
    }

    // Break after processing one post (you can remove if you want to process all)
    break;
  }

  // Update total scanned posts count in storage
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
    const likeButton =
      post.querySelector(SELECTORS.likeButton[0]) ||
      post.querySelector(SELECTORS.likeButton[1]);

    if (!likeButton) {
      return;
    }

    simulateMouseClick(likeButton);
    await new Promise((resolve) =>
      setTimeout(resolve, getRandomDelay(1000, 3000))
    );

    // Get stored data from Chrome storage using the utility function
    const topicEngData = await getFromChromeStorage("topic_eng_data", {});

    // Validate that we have the required data
    if (!topicEngData.business_id || !topicEngData.topic_id || !contact_id) {
      console.error("Missing required topic engagement data:", topicEngData);
      return;
    }

    // Make activity API call
    await chrome.runtime.sendMessage({
      action: "MAKE_ACTIVITY_API_CALL",
      payload: {
        activityId: topicEngData?.last_activity_id, // Use the new function here

        businessId: topicEngData.business_id,
        engagement_type: "like",
        segmentId: topicEngData.topic_id,
        customerId: contact_id,
        posterName: getPosterName(post),
        posterProfile: getPosterProfile(post),
        postUrl: getPostUrl(post),
        postId: getPostId(post),
        isAutoPost: autoPostEnabled,
      },
    });
    postsLiked++;
    updateStats();
  } catch (e) {
    console.error("Error liking the post: ", e);
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
              console.error(
                "Missing required topic engagement data:",
                topicEngData
              );
              return;
            }
            await chrome.runtime.sendMessage({
              action: "MAKE_ACTIVITY_API_CALL",
              payload: {
                activityId: topicEngData?.last_activity_id, // Use the new function here

                businessId: topicEngData?.business_id,
                engagement_type: "comment", // Assuming only comments for now
                segmentId: topicEngData.topic_id,
                customerId: topicEngData.contact_id,
                posterName: getPosterName(post),
                posterProfile: getPosterProfile(post),
                postUrl: getPostUrl(post),
                postId: getPostId(post),

                isAutoPost: true,
                comment: commentText,
              },
            });
            commentsPosted++;
            updateStats();

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

async function postComment(post, comment) {
  try {
    // Find comment input field
    const commentButton =
      post.querySelector(SELECTORS.commentButton[0]) ||
      post.querySelector(SELECTORS.commentButton[1]);

    if (!commentButton) {
      // Try to open comment section first
      const openCommentButton = post.querySelector(
        SELECTORS.openCommentButton[1]
      );
      if (openCommentButton) {
        simulateMouseClick(openCommentButton);

        // Wait for comment section to load
        await new Promise((resolve) =>
          setTimeout(resolve, getRandomDelay(1000, 3000))
        );
      }
    }

    if (comment[0] === '"') {
      comment = comment.slice(1, -1);
    } else if (comment[comment.length - 1] === '"') {
      comment = comment.slice(0, -1);
    } else if (comment[0] === "'") {
      comment = comment.slice(1, -1);
    } else if (comment[comment.length - 1] === "'") {
      comment = comment.slice(0, -1);
    }

    // Find comment input after opening comments
    const commentInput =
      post.querySelector(SELECTORS.commentInput[0]) ||
      post.querySelector(SELECTORS.commentInput[1]);

    if (!commentInput) {
      throw new Error("Comment input or submit button not found");
    }

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
      console.error(
        `Comment submit button not found or not enabled for post ${getPostId(
          post
        )} after polling. Selectors attempted:`,
        submitButtonSelectors
      );
      throw new Error(
        "Comment submit button not found or not enabled after polling"
      );
    }

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
      console.warn(
        `Submit button for post ${getPostId(
          post
        )} is disabled before auto-post attempt. The input simulation might not have fully enabled it. Consider using simulateTyping for more robust interaction.`
      );
    }

    if (autoPostEnabled) {
      // Click submit button
      simulateMouseClick(submitButton);
    }
    // Set next engagement time after successful comment
    setNextEngagementTime(minDelay, maxDelay);
    return true;
  } catch (error) {
    console.error("Error posting comment:", error);
    return false;
  }
}

// Update stats in storage
function updateStats() {
  chrome.storage.local.set({
    commentsPosted: commentsPosted,
    postsScanned: postsScanned,
    postsLiked: postsLiked,
  });
}

// Helper function to check if post is already engaged via API
async function checkIfPostEngaged(postId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "CHECK_POST_ENGAGEMENT",
        postId: postId,
      },
      (response) => {
        console.log(`Response from background for post ${postId}:`, response);

        // Check response.data.error to determine engagement status
        if (response && response.data) {
          console.log("response 1");
          if (response.data.error === false) {
            console.log("response 2");
            resolve(false); // Not engaged when error is false
          } else if (response.data.error === true) {
            console.log("response 3");
            resolve(true); // Engaged when error is true
          } else {
            console.log("response 4");
            resolve(false); // Default to not engaged if error property is undefined
          }
        } else {
          console.log("response 5");
          resolve(false); // Default to not engaged if no data
        }
      }
    );
  });
}

async function checkPostRelevanceAPIpost(postContent) {
  try {
    const topicEngData = await getFromChromeStorage("topic_eng_data", {});
    if (!topicEngData?.goal_prompt) return null;
    const userPrompt = `BUSINESS GOAL: ${topicEngData?.goal_prompt}\nLINKEDIN POST: ${postContent}`;
    const body = JSON.stringify({
      model: "llama3.1:latest",
      messages: [
        { role: "system", content: topicSystemPrompt },
        { role: "user", content: userPrompt },
      ],
      options: { max_token: 100, repeat_penalty: 1.2, temperature: 0.7 },
    });
    const serverUrl = `${APIURL}/ai/chat`;
    const data = await callApi({
      action: "API_POST_GENERATE_MESSAGE",
      url: serverUrl,
      method: "POST",
      body,
    });
    return data?.data?.data || null;
  } catch (error) {
    console.error("Error checking post relevance:", error);
    return null;
  }
}

async function engageWithFirstScannedPost() {
  console.log(
    `=== engageWithFirstScannedPost ENTRY === apiPageStart: ${apiPageStart}`
  );

  if (postsLiked >= dailyLimit || commentsPosted >= dailyLimit) {
    console.log("Daily limit reached, exiting");
    chrome.storage.local.get("limitNotificationShown", function (data) {
      if (!data.limitNotificationShown) {
        showNotification(
          `Congratulations! You have achieved your daily goal of ${dailyLimit} interactions over posts.`,
          "success"
        );
        chrome.storage.local.set({ limitNotificationShown: true });
      }
    });
    return "DAILY_LIMIT_REACHED";
  }

  if (window.__mp_engaged_specific_post) {
    console.log(
      "Already processing, exiting due to __mp_engaged_specific_post flag"
    );
    return "ALREADY_PROCESSING";
  }

  window.__mp_engaged_specific_post = true;
  console.log(
    `Set __mp_engaged_specific_post to true, proceeding with apiPageStart: ${apiPageStart}`
  );

  SELECTORS = await getSelectors();
  if (!SELECTORS) {
    showNotification(
      "Failed to load extension selectors. Please try again later!",
      "warning"
    );
    return "SELECTORS_FAILED";
  }

  // For /search/results/content, use API with dynamic parameters
  if (window.location.pathname?.startsWith("/search/results/content")) {
    console.log("Processing search results page with API");
    try {
      // Only wait on the FIRST page (page 0), skip wait on subsequent pages
      if (apiPageStart === 0) {
        console.log("First page - waiting for next engagement timing");
        await waitForNextEngagement(minDelay, maxDelay);
      } else {
        console.log(
          `Page ${apiPageStart} - skipping wait for faster pagination`
        );
      }

      let foundPostId = null;
      let allPostsProcessed = true; // Track if all posts are processed

      // Fetch posts with current page start
      console.log(`Fetching posts with apiPageStart: ${apiPageStart}`);
      const posts = await fetchPostsFromAPI(apiPageStart);
      console.log(`Fetched ${posts.length} posts from API`);
      console.log(
        `API Response for start=${apiPageStart}:`,
        posts.map((p) => ({
          postId: p.postId,
          content: p.content.substring(0, 50) + "...",
        }))
      );

      if (!posts.length) {
        console.log("No posts found, redirecting");
        showNotification(
          "No eligible and relevant post found to engage.",
          "warning"
        );
        isApiPaginating = false;
        processedPostIds.clear();
        chrome.runtime.sendMessage({
          action: "DELAYED_FEED_REDIRECT",
          minDelay,
          maxDelay,
          url: await getRandomTopicUrl(),
        });
        return "NO_POSTS_FOUND";
      }

      // Filter out already processed posts to avoid duplicates
      const newPosts = posts.filter(
        (post) => !processedPostIds.has(post.postId)
      );
      console.log(
        `Found ${newPosts.length} new posts after filtering ${
          posts.length - newPosts.length
        } duplicates`
      );

      if (!newPosts.length) {
        console.log("No new posts found after filtering duplicates");
        // If no new posts, try increasing the start parameter more aggressively
        apiPageStart += 3; // Skip further ahead

        if (apiPageStart >= MAX_API_PAGES * 3) {
          console.log("Exhausted pagination attempts, redirecting");
          isApiPaginating = false;
          processedPostIds.clear();
          apiPageStart = 0;
          chrome.runtime.sendMessage({
            action: "DELAYED_FEED_REDIRECT",
            minDelay,
            maxDelay,
            url: await getRandomTopicUrl(),
          });
          return "NO_NEW_POSTS";
        }

        // Try next page immediately
        window.__mp_engaged_specific_post = false;
        return await engageWithFirstScannedPost();
      }

      // Process only new posts
      for (const post of newPosts) {
        // Add to processed set immediately to prevent reprocessing
        processedPostIds.add(post.postId);

        console.log(`Processing new post ${post.postId}`);
        const postUrn = "urn:li:activity:" + post.postId;
        const engaged = await checkIfPostEngaged(postUrn);
        console.log(`Post ${post.postId} engagement status:`, engaged);

        // If engaged = false, means already engaged (skip)
        // If engaged = true, means not engaged yet (check relevance)
        if (!engaged) {
          console.log(`Post ${post.postId} already engaged, skipping.`);
          continue; // This post is processed (already engaged)
        }

        // Post is not engaged, check relevance
        console.log(`Checking relevance for post ${post.postId}`);
        const relevanceResult = await checkPostRelevanceAPIpost(post.content);
        const relevanceText = String(relevanceResult || "")
          .toLowerCase()
          .trim();
        const NOT_RELEVANT_REGEX = /\bnot relevant\b/;
        const RELEVANT_REGEX = /\brelevant\b/;

        console.log(`Post ${post.postId} relevance result:`, relevanceResult);

        if (
          !relevanceResult ||
          relevanceResult === null ||
          relevanceText === "" ||
          NOT_RELEVANT_REGEX.test(relevanceText)
        ) {
          console.log(`Post ${post.postId} is not relevant, skipping...`);
          continue; // This post is processed (not relevant)
        }

        if (RELEVANT_REGEX.test(relevanceText)) {
          console.log(`Found relevant post ${post.postId} to engage with!`);
          foundPostId = post.postId;
          allPostsProcessed = false; // We found a post to engage, so not all processed
          break;
        }
      }

      if (foundPostId) {
        console.log(`Engaging with post ${foundPostId}`);
        // Reset counters and clear processed posts when we find a post to engage with
        apiPageStart = 0;
        processedPostIds.clear(); // Clear the processed posts set
        isApiPaginating = false;
        await new Promise((resolve) =>
          setTimeout(resolve, getRandomDelay(5000, 10000))
        );
        const postUrn = `urn:li:activity:${foundPostId}`;
        const postUrl = `https://www.linkedin.com/feed/update/${postUrn}`;
        console.log(`Redirecting to post URL: ${postUrl}`);
        window.location.href = postUrl;
        return "POST_FOUND";
      }

      // Only increment page start if ALL posts were processed (engaged or not relevant)
      if (allPostsProcessed) {
        apiPageStart += 3; // Increment by 3 for next batch of posts
        console.log(
          `All posts on page processed. Moving to next page start: ${apiPageStart}`
        );

        // Check if we've reached the maximum page limit
        if (apiPageStart >= MAX_API_PAGES * 3) {
          console.log(
            `Reached maximum page limit. Redirecting to random topic.`
          );
          showNotification(
            `Checked ${MAX_API_PAGES} pages, no relevant posts found.`,
            "info"
          );

          // Reset counters and clear processed posts
          apiPageStart = 0;
          processedPostIds.clear();
          isApiPaginating = false;

          chrome.runtime.sendMessage({
            action: "DELAYED_FEED_REDIRECT",
            minDelay,
            maxDelay,
            url: await getRandomTopicUrl(),
          });
          return "MAX_PAGES_REACHED";
        }

        // Set pagination flag to prevent startScanning interference
        isApiPaginating = true;

        // Reset the flag to allow recursive processing
        window.__mp_engaged_specific_post = false;

        console.log("About to wait before recursive call...");
        await new Promise(
          (resolve) => setTimeout(resolve, getRandomDelay(15000, 22000)) // Shorter delay for pagination
        );

        console.log(
          "Wait completed, about to call engageWithFirstScannedPost recursively..."
        );
        console.log("Current URL:", window.location.href);
        console.log("Current pathname:", window.location.pathname);

        try {
          const result = await engageWithFirstScannedPost(); // Recursive call for next page
          console.log(
            "Recursive call to engageWithFirstScannedPost completed with result:",
            result
          );
          return result;
        } catch (recursiveError) {
          console.error(
            "Error in recursive engageWithFirstScannedPost call:",
            recursiveError
          );
          isApiPaginating = false;
          throw recursiveError;
        }
      }
    } catch (e) {
      console.error("Error in search results processing:", e);
      // Reset counters on error
      apiPageStart = 0;
      processedPostIds.clear();
      isApiPaginating = false;

      showNotification("Error finding post to engage.", "error");
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(),
      });
      return "ERROR_OCCURRED";
    }
  }

  // For individual post pages, continue with existing DOM engagement logic
  if (window.location.pathname.startsWith("/feed/update/")) {
    console.log("Processing individual post page");
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, getRandomDelay(1000, 2000))
      );
      await scanPosts();
      return "POST_PAGE_PROCESSED";
    } catch (e) {
      console.error("Error engaging with post:", e);
      showNotification("Error engaging with post.", "error");
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(),
      });
      return "POST_ENGAGEMENT_ERROR";
    }
  }

  console.log("No matching page type found");
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
