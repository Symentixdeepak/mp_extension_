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
  defaultEndPrompt,
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
let userPrompt = DEFAULT_SETTINGS.userPrompt;

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

function clearNextEngagementTime() {
  localStorage.removeItem(NEXT_ENGAGEMENT_KEY);
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
              });

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
  // console.log("LinkedIn Auto Commenter initialized");
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

  // Return early (don't initialize) if any of these conditions are true:
  if (
    engagementStatus === "started" ||
    !isFeedCommenterActive?.topic_commenter_active ||
    !topicCheck
  ) {
    console.log("LinkedIn Auto Commenter: Initialization skipped.");

    if (engagementStatus === "started") {
      console.log("Reason: Engagement status is 'started'");
    } else if (!isFeedCommenterActive?.topic_commenter_active) {
      console.log("Reason: Topic commenter is not active");
    } else if (!topicCheck) {
      console.log("Reason: Topic not managed");
    }

    return; // Exit - don't initialize
  }

  // Continue with initialization only if ALL conditions are met:
  // - engagementStatus is NOT "started"
  // - topic_commenter_active is true
  // - topicCheck is true

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
    ]);

    console.log("refres setting starts...");
    extensionActive = data.active !== false;
    // extensionActive = false;

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
    userPrompt = data.userPrompt || DEFAULT_SETTINGS.userPrompt;
    console.log("refresh setting finished...", data);
  }

  // async function initScan() {
  await refreshSettings();
  if (extensionActive) {
    await startScanning();
  }
  // }

  // Add message listener for popup communication
  chrome.runtime.onMessage.addListener(async function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "updateActiveState") {
      console.log("settings got update!!!");
      // extensionActive = request.active;
      console.log({ extensionActive });
      await refreshSettings();
      console.log({ extensionActive });
      if (extensionActive && !isProcessing) {
        await startScanning();
      }
    }
    return true;
  });
}

// Start scanning for posts
async function startScanning() {
  if (!extensionActive || isProcessing) return;

  // Wait for next allowed engagement time
  // await waitForNextEngagement(minDelay, maxDelay);

  isProcessing = true;

  // Moved SELECTORS fetch here, so it's fresh for each scan cycle
  // and checked before proceeding.
  SELECTORS = await getSelectors();

  if (!SELECTORS) {
    showNotification(
      "Failed to load extension selectors. Please try again later!",
      "warning"
    );
    isProcessing = false; // Reset before returning
    // Schedule a retry for startScanning after a delay.
    const delay = getRandomDelay(minDelay, maxDelay);
    setTimeout(() => {
      if (extensionActive) startScanning();
    }, delay);
    return;
  }

  // Check daily limit *after* ensuring selectors are loaded and *before* heavy processing

  // Check if we've reached the daily limit
  if (postsLiked >= dailyLimit || commentsPosted >= dailyLimit) {
    chrome.storage.local.get("limitNotificationShown", function (data) {
      if (!data.limitNotificationShown) {
        showNotification(
          `Congratulations! You have achieved your daily goal of ${dailyLimit} interactions over posts.`,
          "success"
        );
        chrome.storage.local.set({ limitNotificationShown: true });
      }
    });
    // isProcessing will be reset in the finally block.
    return;
  }

  try {
    // Wait for the main post container element to appear
    // Use the primary selector you expect for post lists.
    const postListSelector = SELECTORS.postList[0];
    console.log(`Waiting for element: ${postListSelector}`);
    await waitForElement(postListSelector, 20000); // Wait up to 15 seconds (adjust as needed)
    console.log(`Element ${postListSelector} found. Proceeding to scan.`);

    // Now that we know the container exists, proceed with scanning
    // Add a small delay just in case content inside needs rendering time
    await new Promise(
      (resolve) => setTimeout(resolve, getRandomDelay(1000, 2000)) // Shorter delay now
    );

    // Call the actual scanning logic
    await engageWithFirstScannedPost();
    // await scanPosts(); // scanPosts no longer needs the retry logic
  } catch (error) {
    // Handle the case where the element doesn't appear within the timeout
    console.error(
      `Error waiting for post container (${SELECTORS.postList[0]}):`,
      error
    );
    showNotification("Could not find LinkedIn posts to process.", "warning");
    chrome.runtime.sendMessage({
      action: "DELAYED_FEED_REDIRECT",
      minDelay,
      maxDelay,
      url: await getRandomTopicUrl(),
    });
    // Decide if you want to retry later or stop
    // For now, we'll just stop processing for this cycle
    // The finally block will schedule the next attempt.
  } finally {
    isProcessing = false; // Crucial: reset isProcessing in finally
    // Schedule next scan regardless of success/failure of finding posts in this cycle
    const delay = getRandomDelay(minDelay, maxDelay);
    // console.log(`Scheduling next scan in ${delay / 1000} seconds.`);
    const currentUrlSnapshot = window.location.href; // Capture URL for the check in setTimeout
    setTimeout(() => {
      if (extensionActive) {
        // Only proceed if extension is still globally active
        if (window.location.href === currentUrlSnapshot) {
          // Only proceed if URL hasn't changed
          startScanning();
        } else {
          // console.log("StartScanning: Timeout triggered, but URL changed. Not restarting scan on this page.");
        }
      } else {
        // console.log("StartScanning: Timeout triggered, but extension is not active. Not restarting scan.");
      }
    }, delay);
  }
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
async function scanPosts() {
  // Select all posts on the feed
  const postContainers = document.querySelectorAll(SELECTORS.postList[0]);
  // console.log("Found postContainers:", postContainers.length, SELECTORS.postList[0])
  if (postContainers?.length === 0) {
    showNotification("No posts found in this page.", "warning");
    return;
  }

  postsScanned += postContainers.length;
  updateStats();
  // isProcessing is handled by startScanning, so no need to manage it here.
  let engagedPosts = 0;
  let shouldRefresh = true;
  isProcessing = true;

  for (const post of postContainers) {
    const initialUrlForPost = window.location.href;
    let loadingNotification;
    try {
      const postId = getPostId(post);
      if (!postId) continue;

      post.setAttribute("data-auto-commenter-processed", "true");

      const commentButton =
        post.querySelector(SELECTORS.commentButton[0]) ||
        post.querySelector(SELECTORS.commentButton[1]);

      if (commentButton.hasAttribute("disabled")) continue;

      const isPromoted = checkPromotedPosts(post);
      if (isPromoted) continue;

      if (lastProcessedPosts.has(postId)) {
        continue;
      }

      lastProcessedPosts.add(postId);

      const postContent = extractPostContent(post);
      const topComments = await extractTopComments(post);

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

      const generatedComment = await generateComment(postContent, topComments);

      if (window.location.href !== initialUrlForPost) {
        console.log(
          `URL changed during comment generation for post ${postId}. Aborting.`
        );
        if (loadingNotification) loadingNotification.closeNotification();
        break;
      }

      loadingNotification.closeNotification();

      if (!generatedComment || generatedComment?.includes("NULL")) {
        showNotification("Failed to generate comment.", "error");
        continue;
      }

      showNotification("Comment generated!", "success");

      // Extract firstName, lastName, profile, and avatar before posting comment
      const { firstName, lastName } = extractFirstAndLastName(post);
      const mp_linkedinProfile = extractLinkedInProfile(post);
      const avatarUrl = extractAvatarUrl(post);

      try {
        const contactData = await createContactInBackground({
          firstName,
          lastName,
          mp_linkedinProfile,
          avatar: avatarUrl, // Add avatar field if your API supports it
        });
        console.log("Contact created successfully:", contactData);

        // Store contact data and post information in topic_eng_data
        updateLocalStorageObject("topic_eng_data", {
          contact_id: contactData.id || contactData._id,
          business_id: contactData.business_id,
          user_profile_url: mp_linkedinProfile,
          current_post_id: postId,
        });

        if (likePostEnabled) {
          await handleLikePost(post, contactData._id);
        }

        await new Promise(
          (resolve) => setTimeout(resolve, getRandomDelay(2000, 3000)) // Shorter delay now
        );

        // Now pass the contact ID to postComment if needed
        await postComment(post, generatedComment, contactData.id);
        engagedPosts++;
      } catch (contactError) {
        console.log("Failed to create contact:", contactError);
        showNotification(
          "Failed to create contact. Skipping comment.",
          "error"
        );
        chrome.runtime.sendMessage({
          action: "DELAYED_FEED_REDIRECT",
          minDelay,
          maxDelay,
          url: await getRandomTopicUrl(), // Add random topic URL
        });
        continue;
      }
    } catch (error) {
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(), // Add random topic URL
      });
      console.error("Error generating or posting comment:", error);
      showNotification("Error generating comment", "error");
    }

    break;
  }

  // if (engagedPosts === 0 && shouldRefresh) {
  //   refreshPosts();
  // }

  // isProcessing is handled by startScanning's finally block.
  // Update storage
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

// Extract top comments
async function extractTopComments(post) {
  const comments = [];

  const commentBtns = post.getElementsByClassName(
    SELECTORS.openCommentButton[0]
  );
  const commentBtn = commentBtns?.length ? commentBtns[0] : null;
  if (!commentBtn) return comments;

  simulateMouseClick(commentBtn);
  await new Promise((resolve) =>
    setTimeout(resolve, getRandomDelay(2000, 5000))
  );

  const loadMoreBtns = post.getElementsByClassName(
    SELECTORS.loadMoreComments[0]
  );

  const loadMoreBtn = loadMoreBtns?.length ? loadMoreBtns[0] : null;
  if (loadMoreBtn) {
    simulateMouseClick(loadMoreBtn);
    await new Promise((resolve) =>
      setTimeout(resolve, getRandomDelay(2000, 5000))
    );
  }
  // Find comment elements
  const commentElements =
    post.querySelectorAll(SELECTORS.commentElements[0]) ||
    post.querySelectorAll(SELECTORS.commentElements[1]);

  // Get up to 3 comments
  for (let i = 0; i < Math.min(3, commentElements.length); i++) {
    const commentText = commentElements[i].textContent.trim();
    comments.push(commentText);
  }

  return comments;
}

// Generate comment using GPT or custom logic
async function generateComment(postContent, topComments) {
  return await generateGPTComment(postContent, topComments);
}

// Generate comment using GPT API
async function generateGPTComment(postContent, topComments) {
  try {
    const max_words = commentLength;
    const prompt = `Generate comment for post: "${postContent}"`;
    const finalSystemPrompt = [
      defaultStartPrompt.trim(),
      userPrompt.trim(),
      defaultEndPrompt.trim(),
    ].join("\n");
    const systemPrompt = finalSystemPrompt.replace("{{MAX_WORDS}}", max_words);

    const body = JSON.stringify({
      model: "llama3.1:latest",
      messages: [
        {
          role: "system",
          content: systemPrompt,
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

async function getCommentUrl(post) {
  try {
    const commentElements =
      post.querySelectorAll(SELECTORS.commentElements[0]) ||
      post.querySelectorAll(SELECTORS.commentElements[1]);
    if (!commentElements?.length) {
      console.log("No comment elements found for post!");
      return;
    }

    const commentElement = commentElements[0];
    const userComment = commentElement.querySelector(SELECTORS.commentURN[0]);

    if (!userComment) {
      console.log("No user comment found for post");
      return;
    }

    const commentURN = userComment.getAttribute("data-id");
    if (!commentURN) {
      console.log("No comment URN found for post");
      return;
    }

    // const postId = getPostId(post);
    const commentURL = `${getPostUrl(post)}?commentUrn=${commentURN}`;

    await tracker.addEngagement({
      postId: getPostId(post),
      commentURL,
    });
  } catch (e) {
    console.error("Error getting comment url: ", e);
  }
}

// Post comment to LinkedIn
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
        console.log(
          `Response from background for post ${postId}:`,
          response
        );
        if (chrome.runtime.lastError) {
          console.error(
            "Error checking post engagement:",
            chrome.runtime.lastError
          );
          resolve(false); // Assume not engaged on error
          return;
        }

        // If we get any data back, consider it engaged
        const isEngaged = response && response.success && response.data;
        resolve(!!isEngaged);
      }
    );
  });
}

// Function to get the current post's poster profile URL
async function getCurrentPostPosterProfileUrl() {
  try {
    // Wait for the post header to load
    // await waitForElement(".feed-shared-update-v2__description-wrapper", 5000);

    // Find the span with the user's name and get its parent anchor tag
    const nameSpan = document.querySelector(".update-components-actor__title");

    if (nameSpan) {
      // Get the parent anchor tag
      const parentAnchor = nameSpan.closest("a");

      if (parentAnchor && parentAnchor.href) {
        // Clean the URL by removing query parameters
        const cleanUrl = parentAnchor.href.split("?")[0];
        console.log("Found and cleaned poster profile URL:", cleanUrl);
        return cleanUrl;
      }
    }

    console.warn(
      "Could not find poster profile URL from .update-components-actor__title"
    );
    await setToChromeStorage("topic_eng_data", {});
    return await getRandomTopicUrl();
  } catch (error) {
    console.error("Error getting poster profile URL:", error);
    await setToChromeStorage("topic_eng_data", {});
    return await getRandomTopicUrl();
  }
}

// === Custom workflow: Go to first eligible post, then run scanPosts for comment/like ===
async function engageWithFirstScannedPost() {
  if (postsLiked >= dailyLimit || commentsPosted >= dailyLimit) {
    chrome.storage.local.get("limitNotificationShown", function (data) {
      if (!data.limitNotificationShown) {
        showNotification(
          `Congratulations! You have achieved your daily goal of ${dailyLimit} interactions over posts.`,
          "success"
        );
        chrome.storage.local.set({ limitNotificationShown: true });
      }
    });
    return;
  }
  if (window.__mp_engaged_specific_post) return;
  window.__mp_engaged_specific_post = true;

  // Wait for next allowed engagement time
  await waitForNextEngagement(minDelay, maxDelay);

  // Wait for selectors to load
  SELECTORS = await getSelectors();
  if (!SELECTORS) {
    showNotification(
      "Failed to load extension selectors. Please try again later!",
      "warning"
    );
    return;
  }

  // If we're on the feed, scan for the first eligible post and redirect to it
  if (window.location.pathname?.startsWith("/search/results/content")) {
    try {
      const postListSelector = SELECTORS.postList[0];
      await waitForElement(postListSelector, 20000);
      const postContainers = document.querySelectorAll(postListSelector);
      let foundPostId = null;

      for (const post of postContainers) {
        const postId = getPostId(post);
        if (!postId) continue;

        // Check if already engaged via API only
        const engagementResult = await checkIfPostEngaged(postId);
        console.log(
          `Checking post ${postId} engagement status...`,
          engagementResult
        );
        // If there's an error in the API response, skip this post
        if (engagementResult && engagementResult.error === true) {
          console.log(`Post ${postId} has API error, skipping...`);
          continue; // Go to next post in the list
        }

        // If there's engagement data (error = false), skip this post
        if (engagementResult && engagementResult.error === false) {
          console.log(`Post ${postId} already engaged, skipping...`);
          continue; // Go to next post in the list
        }

        // If no engagement data (null/undefined), this post is eligible
        foundPostId = postId;
        break; // Found eligible post, exit loop
      }

      if (!foundPostId) {
        showNotification("No eligible post found to engage.", "warning");
        return;
      }

      // Redirect to the post page
      const postUrl = `https://www.linkedin.com/feed/update/${foundPostId}`;
      window.location.href = postUrl;
      return;
    } catch (e) {
      showNotification("Error finding post to engage.", "error");
      return;
    }
  }

  // If we're on a post page, run scanPosts to handle comment/like
  if (window.location.pathname.startsWith("/feed/update/")) {
    try {
      // Get current post ID from URL
      // Check if current post is already engaged

      await new Promise((resolve) =>
        setTimeout(resolve, getRandomDelay(1000, 2000))
      );
      await scanPosts();

      // Get the current post's poster profile URL
      const posterProfileUrl = await getCurrentPostPosterProfileUrl();
      updateLocalStorageObject("topic_eng_data", {
        posterProfileUrl: posterProfileUrl, // Store the poster's profile URL
      });
      // Send message to background to handle delay and redirect to poster's profile
      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: posterProfileUrl, // Pass the poster's profile URL
      });
    } catch (e) {
      showNotification("Error engaging with post.", "error");

      // Get the current post's poster profile URL even on error

      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(), // Pass the poster's profile URL
      });
    }
    return;
  }
}

// === End custom workflow ===

// Run the custom workflow after DOMContentLoaded
// if (document.readyState === "loading") {
//   document.addEventListener("DOMContentLoaded", engageWithFirstScannedPost);
// } else {
//   engageWithFirstScannedPost();
// }

// Initialize when document is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

// Listen for redirect command from background
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request && request.action === "REDIRECT_TO_FEED") {
//     window.location.href = "https://www.linkedin.com/feed/";
//     window.location.reload();
//   }
// });
