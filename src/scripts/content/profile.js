// profile.js - LinkedIn Profile Scraper with GPT connection request message generation

const { APIURL } = require("../../utils/constant");
const { showNotification } = require("../../utils/notification");
const {
  populateBoards,
  getRandomTopicUrl,
  setToChromeStorage,
  getFromChromeStorage,
  getXLiTrackHeader,
  getAcceptLanguage,
  getXLiLang,
  getSecChUaPlatform,
  getSecChUaMobile,
  getSecChUaHeader,
} = require("../../utils/utils");

const minDelay = 3000;
const maxDelay = 4000;

// Utility function to safely get text content and clean duplicates
function getTextContent(selector, container = document) {
  const element = container.querySelector(selector);
  if (!element) return "";

  let text = element.textContent.trim();
  // Remove duplicate text (e.g., "Google BigQueryGoogle BigQuery" -> "Google BigQuery")
  const words = text.split(" ");
  const cleanWords = [];
  let lastWord = "";

  for (let word of words) {
    if (word !== lastWord) {
      cleanWords.push(word);
    }
    lastWord = word;
  }

  return cleanWords.join(" ");
}

// Clean duplicate text from strings
function cleanDuplicateText(text) {
  if (!text) return "";

  // Handle cases like "TextText" -> "Text"
  const halfLength = Math.floor(text.length / 2);
  if (
    text.length > 1 &&
    text.substring(0, halfLength) === text.substring(halfLength)
  ) {
    return text.substring(0, halfLength);
  }

  // Handle cases with spaces like "Text Text" -> "Text"
  const words = text.split(" ");
  const uniqueWords = [];

  for (let i = 0; i < words.length; i++) {
    if (i === 0 || words[i] !== words[i - 1]) {
      uniqueWords.push(words[i]);
    }
  }

  return uniqueWords.join(" ").trim();
}

// Extract dates and split them properly
function extractDates(dateString) {
  if (!dateString) return { startDate: "", endDate: "", dates: "" };

  const cleanDates = cleanDuplicateText(dateString);

  // Handle different date formats
  if (cleanDates.includes(" - ")) {
    const dateParts = cleanDates.split(" - ");
    return {
      startDate: dateParts[0]?.trim() || "",
      endDate: dateParts[1]?.split("·")[0]?.trim() || "",
      dates: cleanDates,
    };
  }

  return {
    startDate: "",
    endDate: "",
    dates: cleanDates,
  };
}

// Extract poster profile URL
function getCurrentProfileUrl() {
  return window.location.href;
}

// Extract vanity name from profile URL
function getVanityName(profileUrl) {
  const match = profileUrl.match(/\/in\/([^\/]+)/);
  return match ? match[1] : "";
}

// Extract poster name
function getPosterName() {
  const nameSelectors = [
    "h1.text-heading-xlarge",
    "h1.inline.t-24.v-align-middle.break-words",
    ".pv-text-details__left-panel h1",
  ];

  for (const selector of nameSelectors) {
    const name = getTextContent(selector);
    if (name) return cleanDuplicateText(name);
  }
  return "";
}

// Extract first name and last name
function getFirstLastName() {
  const fullName = getPosterName();
  const nameParts = fullName.split(" ").filter((part) => part.length > 0);
  return {
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
  };
}

// Extract location/address
function getAddress() {
  const locationSelectors = [
    ".text-body-small.inline.t-black--light.break-words",
    ".pv-text-details__left-panel .text-body-small",
  ];

  for (const selector of locationSelectors) {
    const location = getTextContent(selector);
    if (
      location &&
      location.includes(",") &&
      !location.includes("followers") &&
      !location.includes("connections")
    ) {
      return cleanDuplicateText(location);
    }
  }
  return "";
}

// Extract job title
function getJobTitle() {
  const jobSelectors = [
    ".text-body-medium.break-words[data-generated-suggestion-target]",
    ".pv-text-details__left-panel .text-body-medium",
  ];

  for (const selector of jobSelectors) {
    const jobTitle = getTextContent(selector);
    if (
      jobTitle &&
      !jobTitle.includes("followers") &&
      !jobTitle.includes("connections")
    ) {
      return cleanDuplicateText(jobTitle);
    }
  }
  return "";
}

// Extract avatar URL
function getAvatar() {
  const avatarSelectors = [
    ".pv-top-card-profile-picture__image",
    ".pv-top-card__photo img",
    ".EntityPhoto-circle-9 img",
  ];

  for (const selector of avatarSelectors) {
    const img = document.querySelector(selector);
    if (img && img.src) {
      return img.src;
    }
  }
  return "";
}

// Extract about section
function getAbout() {
  const xpathSelectors = [
    "//section[@data-view-name='profile-card']//div[contains(@class, 'inline-show-more-text--is-collapsed')]//span[@aria-hidden='true']",
    "//div[@id='about']/following-sibling::div//span[@aria-hidden='true']",
    "//h2[contains(text(), 'About')]/ancestor::section//span[@aria-hidden='true' and string-length(text()) > 50]",
  ];

  for (const xpath of xpathSelectors) {
    const element = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    if (element && element.textContent.trim()) {
      return cleanDuplicateText(element.textContent);
    }
  }
  return "";
}

// Extract education data with improved parsing
function getEducation() {
  const educationSection = document.querySelector("#education");
  if (!educationSection) return [];

  const educationList = [];
  const educationItems = educationSection
    .closest(".artdeco-card")
    .querySelectorAll(".artdeco-list__item");

  educationItems.forEach((item) => {
    const institutionElement = item.querySelector(
      ".hoverable-link-text.t-bold, .t-bold"
    );
    const degreeElement = item.querySelector(
      ".t-14.t-normal:not(.t-black--light)"
    );
    const datesElement = item.querySelector(
      ".t-14.t-normal.t-black--light .pvs-entity__caption-wrapper"
    );

    if (institutionElement) {
      const institution = cleanDuplicateText(
        institutionElement.textContent.trim()
      );
      const degree = degreeElement
        ? cleanDuplicateText(degreeElement.textContent.trim())
        : "";
      const datesText = datesElement ? datesElement.textContent.trim() : "";

      // Clean degree field - remove dates if they appear in degree
      let cleanDegree = degree;
      if (datesText && degree.includes(datesText)) {
        cleanDegree = degree.replace(datesText, "").trim();
      }

      const dateInfo = extractDates(datesText);

      educationList.push({
        institution: institution,
        degree: cleanDegree,
        dates: dateInfo.dates,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
      });
    }
  });

  return educationList;
}

// Extract work experience data with improved parsing
function getExperience() {
  const experienceSection = document.querySelector("#experience");
  if (!experienceSection) return [];

  const experienceList = [];
  const experienceItems = experienceSection
    .closest(".artdeco-card")
    .querySelectorAll(".artdeco-list__item");

  experienceItems.forEach((item) => {
    const jobTitleElement = item.querySelector(".hoverable-link-text.t-bold");
    const companyElement = item.querySelector(
      ".t-14.t-normal:not(.t-black--light)"
    );
    const datesElement = item.querySelector(
      ".t-14.t-normal.t-black--light .pvs-entity__caption-wrapper"
    );
    const locationElement = item.querySelector(
      ".t-14.t-normal.t-black--light:not(:has(.pvs-entity__caption-wrapper))"
    );

    if (jobTitleElement && companyElement) {
      const jobTitle = cleanDuplicateText(jobTitleElement.textContent.trim());
      const companyText = cleanDuplicateText(companyElement.textContent.trim());
      const datesText = datesElement ? datesElement.textContent.trim() : "";
      const locationText = locationElement
        ? cleanDuplicateText(locationElement.textContent.trim())
        : "";

      // Parse company and employment type
      const companyParts = companyText.split(" · ");
      const company = companyParts[0] || companyText;
      const employmentType = companyParts[1] || "";

      const dateInfo = extractDates(datesText);

      // Clean location - remove duplicate dates
      let cleanLocation = locationText;
      if (datesText && locationText.includes(datesText)) {
        cleanLocation = locationText.replace(datesText, "").trim();
      }

      experienceList.push({
        jobTitle: jobTitle,
        company: company,
        employmentType: employmentType,
        dates: dateInfo.dates,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        location: cleanLocation,
      });
    }
  });

  return experienceList;
}

// Extract skills data with duplicate removal
function getSkills() {
  const skillsSection = document.querySelector("#skills");
  if (!skillsSection) return [];

  const skillsList = [];
  const skillItems = skillsSection
    .closest(".artdeco-card")
    .querySelectorAll(".hoverable-link-text.t-bold");

  skillItems.forEach((item) => {
    const skill = cleanDuplicateText(item.textContent.trim());
    if (skill && !skill.includes("Show all") && !skill.includes("skills")) {
      skillsList.push(skill);
    }
  });

  // Remove duplicate skills
  return [...new Set(skillsList)];
}

// Get CSRF Token
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

// Helper function for API calls
async function callApi(config) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(config, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// Generate GPT Connection Request Message function
async function generateConnectionRequestMessage() {
  try {
    // Extract profile data
    const { firstName, lastName } = getFirstLastName();
    const jobTitle = getJobTitle();
    const about = getAbout();

    // Handle cases where profile data might be missing
    const hasJobTitle = jobTitle && jobTitle.trim().length > 0;
    const hasAbout = about && about.trim().length > 0;
    const hasName = firstName && firstName.trim().length > 0;

    // If no meaningful data is available, return null
    if (!hasName && !hasJobTitle && !hasAbout) {
      console.log(
        "No meaningful profile data found for connection message generation"
      );
      return null;
    }

    // Create prompt with available profile data

    // Build dynamic prompt based on available data
    let profileInfo = `Name: ${firstName} ${lastName}`.trim();

    if (hasJobTitle) {
      profileInfo += `\nJob Title: ${jobTitle}`;
    }

    if (hasAbout) {
      profileInfo += `\nAbout: ${about.substring(0, 200)}`;
    }

    const prompt = `Generate a professional LinkedIn connection request message for:
${profileInfo}

Create a personalized, professional connection request message in 10-15 words${
      hasJobTitle || hasAbout
        ? " that references their available profile information"
        : " based on their name"
    }.`;

    const systemPrompt = `You are a professional LinkedIn connection request message generator. Generate personalized, professional connection request messages based on the person's profile data.

Rules:
1. Keep message between 10-15 words
2. Be professional and friendly
3. Reference their job title or background if available
4. Make it personalized but not overly familiar
5. Don't ask questions
6. Use professional tone
7. Output ONLY the message text, no quotes or explanations
8. If unable to generate a proper message, return NULL

Guidelines for different scenarios:
- If job title is available: Reference their professional role
- If only about section is available: Reference their background/interests
- If only name is available: Create a general professional connection message
- If no meaningful data: Return NULL

Examples:
- "Hi John, fellow software engineer interested in connecting and sharing insights."
- "Hello Sarah, admire your marketing expertise, would love to connect professionally."
- "Hi Mike, impressed by your data science background, let's connect and network."
- "Hi Lisa, would love to connect and expand our professional network."
`;

    const body = JSON.stringify({
      model: "llama3.1:latest",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: prompt },
      ],
      options: {
        max_token: 100,
        repeat_penalty: 1.2,
        temperature: 0.7,
      },
    });

    const serverUrl = `${APIURL}/ai/chat`;

    const data = await callApi({
      action: "API_POST_GENERATE_MESSAGE",
      url: serverUrl,
      method: "POST",
      body,
    });

    console.log("GPT connection request response:", data);

    if (data.error) {
      console.error("GPT API error:", data.error);
      return null;
    }

    const generatedMessage = data.data.data;

    // Check if the response contains NULL or is invalid
    if (
      !generatedMessage ||
      generatedMessage.toLowerCase().includes("null") ||
      generatedMessage.toLowerCase().trim() === "null" ||
      generatedMessage.trim().length === 0
    ) {
      console.log("GPT returned NULL or invalid message");
      return null;
    }

    // Clean the message - remove quotes and trim
    let cleanMessage = generatedMessage.trim();
    if (
      (cleanMessage.startsWith('"') && cleanMessage.endsWith('"')) ||
      (cleanMessage.startsWith("'") && cleanMessage.endsWith("'"))
    ) {
      cleanMessage = cleanMessage.slice(1, -1).trim();
    }

    // Additional cleaning for any remaining quotes or formatting
    cleanMessage = cleanMessage.replace(/^["']|["']$/g, "").trim();

    // Final validation - if message is empty after cleaning, return null
    if (!cleanMessage || cleanMessage.length === 0) {
      console.log("Message is empty after cleaning");
      return null;
    }

    // Validate word count (10-15 words, but allow 8-18 for flexibility)
    const wordCount = cleanMessage
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
    if (wordCount < 5 || wordCount > 20) {
      console.log(
        `Message word count (${wordCount}) outside acceptable range, returning null`
      );
      return null;
    }

    console.log(
      `Generated connection message (${wordCount} words):`,
      cleanMessage
    );
    console.log(
      `Profile data used - Name: ${firstName} ${lastName}, Job: ${
        hasJobTitle ? jobTitle : "N/A"
      }, About: ${hasAbout ? "Available" : "N/A"}`
    );

    return cleanMessage;
  } catch (error) {
    console.error("Error generating connection request message:", error);
    return null;
  }
}

// Main function to make activity API call
// Modified function to make activity API call with optional message
async function makeActivityApiCall(
  topicEngData,
  engagementType = "visit",
  message = null
) {
  try {
    // Validate that we have the required data
    if (
      !topicEngData.business_id ||
      !topicEngData.topic_id ||
      !topicEngData.contact_id
    ) {
      console.log("Missing required topic engagement data:", topicEngData);
      throw new Error("Missing required topic engagement data");
    }

    const payload = {
      activityId: topicEngData?.last_activity_id,
      businessId: topicEngData.business_id,
      engagement_type: engagementType,
      segmentId: topicEngData.topic_id,
      customerId: topicEngData.contact_id,
      isAutoPost: true,
    };

    // Add message to payload if provided
    if (message) {
      payload.message = message;
    }

    await chrome.runtime.sendMessage({
      action: "MAKE_ACTIVITY_API_CALL",
      payload: payload,
    });

    console.log(
      `Activity API call completed successfully with type: ${engagementType}${
        message ? " with message" : ""
      }`
    );
    return true;
  } catch (error) {
    console.log("Error making activity API call:", error);
    throw error;
  }
}

// Main function to update contact
async function updateContactAction() {
  try {
    // Helper function to safely get values
    const safeGetValue = (fn, fieldName) => {
      try {
        const value = fn();
        return value || "";
      } catch (error) {
        console.log(`Failed to get ${fieldName}:`, error);
        return "";
      }
    };

    // Safely get all contact data
    const { firstName, lastName } = safeGetValue(
      getFirstLastName,
      "firstName/lastName"
    ) || { firstName: "", lastName: "" };
    const address = safeGetValue(getAddress, "address");
    const jobTitle = safeGetValue(getJobTitle, "jobTitle");
    const avatar = safeGetValue(getAvatar, "avatar");
    const about = safeGetValue(getAbout, "about");
    const education = safeGetValue(getEducation, "education");
    const experience = safeGetValue(getExperience, "experience");
    const skills = safeGetValue(getSkills, "skills");

    // Create summary JSON object (only include non-empty values)
    const summaryData = {};
    if (about) summaryData.about = about;
    if (education) summaryData.education = education;
    if (experience) summaryData.experience = experience;
    if (skills) summaryData.skills = skills;

    const summary = JSON.stringify(summaryData);

    const topicEngData = await getFromChromeStorage("topic_eng_data", {});

    // Validate that we have the required data
    if (!topicEngData.business_id || !topicEngData.contact_id) {
      console.log("Missing required topic engagement data:", topicEngData);
      throw new Error("Missing required topic engagement data");
    }

    const contactData = {
      address: address,
      jobTitle: jobTitle,
      avatar: avatar,
      contact_id: topicEngData.contact_id,
      business_id: topicEngData.business_id,
      summary: summary,
    };

    // Log what data was successfully collected
    console.log("Successfully collected data:", {
      address: !!address,
      jobTitle: !!jobTitle,
      avatar: !!avatar,
      about: !!about,
      education: !!education,
      experience: !!experience,
      skills: !!skills,
    });

    await chrome.runtime.sendMessage({
      action: "UPDATE_CONTACT_ACTION",
      data: contactData,
    });

    console.log("Contact update completed successfully", contactData);
    return true;
  } catch (error) {
    console.log("Error updating contact:", error);
    throw error;
  }
}

// Fetch profile API
async function fetchProfileApi(vanityName, csrfToken) {
  const secChUaHeader = await getSecChUaHeader();
  const secChUaMobile = getSecChUaMobile();
  const secChUaPlatform = getSecChUaPlatform();
  const xLiLang = getXLiLang();
  const acceptLanguage = getAcceptLanguage();
  const xLiTrackHeader = getXLiTrackHeader();
  try {
    const response = await fetch(
      `https://www.linkedin.com/voyager/api/graphql?includeWebMetadata=true&variables=(vanityName:${vanityName})&queryId=voyagerIdentityDashProfiles.ee32334d3bd69a1900a077b5451c646a`,
      {
        headers: {
          accept: "application/vnd.linkedin.normalized+json+2.1",
          "accept-language": acceptLanguage,
          "csrf-token": csrfToken,
          priority: "u=1, i",
          "sec-ch-prefers-color-scheme": "dark",
          "sec-ch-ua": secChUaHeader,
          "sec-ch-ua-mobile": secChUaMobile,
          "sec-ch-ua-platform": secChUaPlatform,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-li-lang": xLiLang,
          "x-li-page-instance":
            "urn:li:page:d_flagship3_profile_view_base;fILxOF9sQQaKwBGRmfSksA==",
          "x-li-pem-metadata": "Voyager - Profile=profile-top-card-core",
          "x-li-track": xLiTrackHeader,
          "x-restli-protocol-version": "2.0.0",
        },
        referrer:
          "https://www.linkedin.com/mynetwork/invite-connect/connections/",
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        method: "GET",
        mode: "cors",
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Profile API failed with status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Profile API response:", data);

    // Extract member profile ID
    const memberProfile =
      data?.data?.data?.identityDashProfilesByMemberIdentity?.[
        "*elements"
      ]?.[0];
    if (!memberProfile) {
      throw new Error("Member profile not found in response");
    }

    return memberProfile;
  } catch (error) {
    console.log("Error fetching profile:", error);
    throw error;
  }
}

// Modified send connection request API with customMessage support
async function sendConnectionRequest(
  memberProfileId,
  csrfToken,
  customMessage = null
) {
  const secChUaHeader = await getSecChUaHeader();
  const secChUaMobile = getSecChUaMobile();
  const secChUaPlatform = getSecChUaPlatform();
  const xLiLang = getXLiLang();
  const acceptLanguage = getAcceptLanguage();
  const xLiTrackHeader = getXLiTrackHeader();

  try {
    // Prepare the request body
    const requestBody = {
      invitee: {
        inviteeUnion: {
          memberProfile: memberProfileId,
        },
      },
    };

    // Only add customMessage if it's provided and not null
    if (customMessage) {
      requestBody.customMessage = customMessage;
    } else {
      requestBody.customMessage = "";
    }

    const response = await fetch(
      "https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2",
      {
        headers: {
          accept: "application/vnd.linkedin.normalized+json+2.1",
          "accept-language": acceptLanguage,
          "content-type": "application/json; charset=UTF-8",
          "csrf-token": csrfToken,
          priority: "u=1, i",
          "sec-ch-prefers-color-scheme": "dark",
          "sec-ch-ua": secChUaHeader,
          "sec-ch-ua-mobile": secChUaMobile,
          "sec-ch-ua-platform": secChUaPlatform,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-li-deco-include-micro-schema": "true",
          "x-li-lang": xLiLang,
          "x-li-page-instance":
            "urn:li:page:d_flagship3_profile_view_base;RSd+9vLrTzqqZhSpO+AWDA==",
          "x-li-pem-metadata":
            "Voyager - Profile Actions=topcard-overflow-connect-action-click,Voyager - Invitations - Actions=invite-send",
          "x-li-track": xLiTrackHeader,
          "x-restli-protocol-version": "2.0.0",
        },
        body: JSON.stringify(requestBody),
        method: "POST",
        mode: "cors",
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(
        `Connection request failed with status: ${response.status}`
      );
    }

    const data = await response.json();
    console.log("Connection request sent successfully:", data);
    return true;
  } catch (error) {
    console.log("Error sending connection request:", error);
    throw error;
  }
}

// Handle redirect after error or completion
async function handleRedirect() {
  await setToChromeStorage("topic_eng_data", {});

  chrome.runtime.sendMessage({
    action: "DELAYED_FEED_REDIRECT",
    minDelay,
    maxDelay,
    url: await getRandomTopicUrl(),
  });
}

// Main initialization function with GPT connection request integration
async function initializeProfile() {
  try {
    console.log("Profile.js initializing...");

    // Wait for page to be fully loaded
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get topic engagement data
    const topicEngData = await new Promise((resolve) => {
      chrome.storage.local.get(["topic_eng_data"], (result) => {
        resolve(result.topic_eng_data || {});
      });
    });

    // Initialize userPrompt from storage if available
    if (topicEngData.userPrompt) {
      userPrompt = topicEngData.userPrompt;
    }

    // Get current page URL
    const currentPageUrl = getCurrentProfileUrl();

    console.log("Current page URL:", currentPageUrl);
    console.log(
      "Poster profile URL from storage:",
      topicEngData.posterProfileUrl
    );

    // NEW: Check if current URL contains /in/ - if not, handle redirect
    if (!currentPageUrl.includes("/in/")) {
      console.log("Current URL does not contain '/in/' - handling redirect");
      await handleRedirect();
      return;
    }

    // Only proceed if the current page URL matches the poster profile URL
    const normalizedPosterUrl = topicEngData.posterProfileUrl.replace(
      /\/$/,
      ""
    );
    const normalizedCurrentUrl = currentPageUrl.replace(/\/$/, "");

    if (normalizedPosterUrl === normalizedCurrentUrl) {
      console.log("URLs match - proceeding with profile engagement");

      // Step 1: Make activity API call with type "visit" (regardless of success/failure, continue)
      try {
        await makeActivityApiCall(topicEngData, "visit");
      } catch (error) {
        console.log("Visit activity API call failed, but continuing:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 2: Update contact action (regardless of success/failure, continue)
      try {
        await updateContactAction();
      } catch (error) {
        console.log("Update contact action failed, but continuing:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 3: Fetch profile and send connection request
      try {
        // Get vanity name from current URL
        const vanityName = getVanityName(currentPageUrl);
        if (!vanityName) {
          throw new Error("Could not extract vanity name from URL");
        }

        // Get CSRF token
        const csrfToken = await getCsrfToken();
        if (!csrfToken) {
          throw new Error("Could not get CSRF token");
        }

        // Fetch profile
        const memberProfile = await fetchProfileApi(vanityName, csrfToken);
        console.log("Profile fetch completed successfully");

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Step 4: Generate GPT connection request message after successful profile fetch
        let customMessage = null;
        try {
          console.log("Generating GPT connection request message...");
          const generatedMessage = await generateConnectionRequestMessage();

          if (
            generatedMessage &&
            !generatedMessage.toLowerCase().includes("null")
          ) {
            // Clean the message - remove Note: section and reference: section
            let cleanedMessage = generatedMessage;

            // Remove "Note:" section and everything after it
            if (cleanedMessage.toLowerCase().includes("note:")) {
              cleanedMessage = cleanedMessage.split(/note:/i)[0].trim();
            }

            // Remove "reference:" section and everything after it
            if (cleanedMessage.toLowerCase().includes("reference:")) {
              cleanedMessage = cleanedMessage.split(/reference:/i)[0].trim();
            }

            // Remove any trailing punctuation or extra whitespace
            cleanedMessage = cleanedMessage.replace(/\s+/g, " ").trim();

            // Final validation - ensure we still have a meaningful message
            if (cleanedMessage && cleanedMessage.length > 5) {
              customMessage = cleanedMessage;
              console.log(
                "GPT connection request message generated and cleaned successfully:",
                customMessage
              );
            } else {
              console.log(
                "GPT connection request generation resulted in empty message after cleaning"
              );
            }
          } else {
            console.log(
              "GPT connection request generation failed or returned NULL"
            );
          }
        } catch (error) {
          console.log(
            "Error generating GPT connection request message:",
            error
          );
        }

        // Step 5: Send connection request with retry logic
        let connectionSuccess = false;
        let sentWithMessage = false; // Track if connection was sent with custom message

        // First attempt with custom message (if available)
        if (customMessage) {
          try {
            console.log("Sending connection request with custom message...");
            await sendConnectionRequest(
              memberProfile,
              csrfToken,
              customMessage
            );
            connectionSuccess = true;
            sentWithMessage = true; // Mark as sent with message
            console.log(
              "Connection request with custom message sent successfully"
            );
          } catch (error) {
            console.log(
              "Connection request with custom message failed:",
              error
            );

            // Retry without custom message
            try {
              console.log(
                "Retrying connection request without custom message..."
              );
              await sendConnectionRequest(memberProfile, csrfToken);
              connectionSuccess = true;
              sentWithMessage = false; // Mark as sent without message
              console.log(
                "Connection request without custom message sent successfully"
              );
            } catch (retryError) {
              console.log("Connection request retry also failed:", retryError);
            }
          }
        } else {
          // Send without custom message
          try {
            console.log("Sending connection request without custom message...");
            await sendConnectionRequest(memberProfile, csrfToken);
            connectionSuccess = true;
            sentWithMessage = false; // Mark as sent without message
            console.log("Connection request sent successfully");
          } catch (error) {
            console.log("Connection request failed:", error);
          }
        }

        // If connection request failed completely, handle redirect
        if (!connectionSuccess) {
          console.log("All connection request attempts failed");
          await handleRedirect();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Step 6: Make activity API call with type "connectionsent" (only if connection was successful)
        try {
          if (sentWithMessage && customMessage) {
            // Pass the message if connection was sent with custom message
            await makeActivityApiCall(
              topicEngData,
              "connectionsent",
              customMessage
            );
            console.log("Activity API call made with custom message");
          } else {
            // Don't pass message if connection was sent without custom message
            await makeActivityApiCall(topicEngData, "connectionsent");
            console.log("Activity API call made without message");
          }
        } catch (error) {
          console.log("Connection sent activity API call failed:", error);
          await handleRedirect();
          return;
        }
      } catch (error) {
        console.log("Error in profile fetch or connection request:", error);
        await handleRedirect();
        return;
      }

      // Clear the topic_eng_data object from Chrome storage
      await setToChromeStorage("topic_eng_data", {});

      chrome.runtime.sendMessage({
        action: "DELAYED_FEED_REDIRECT",
        minDelay,
        maxDelay,
        url: await getRandomTopicUrl(),
      });

      console.log("Profile initialization completed successfully");
    } else {
      console.log("URLs don't match - doing nothing");
      console.log("Expected:", topicEngData.posterProfileUrl);
      console.log("Current:", currentPageUrl);

      // Do nothing - no redirect, no API calls, no updates
    }
  } catch (error) {
    console.error("Error during profile initialization:", error);
    await handleRedirect();
  }
}

// Auto-initialize when script loads
(function () {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeProfile);
  } else {
    initializeProfile();
  }
})();
