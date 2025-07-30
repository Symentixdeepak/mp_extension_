// profile.js - LinkedIn Profile Scraper with improved data extraction

const { showNotification } = require("../../utils/notification");
const {
  populateBoards,
  getRandomTopicUrl,
  setToChromeStorage,
  getFromChromeStorage,
} = require("../../utils/utils");

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
  const aboutSelectors = [
    '[data-view-name="profile-card"] .ZUjbVnUyeNIBDGDnoONvnCsSlUnEfTYiEco .full-width',
    ".pv-about-section .pv-about__summary-text",
  ];

  for (const selector of aboutSelectors) {
    const about = getTextContent(selector);
    if (about) return cleanDuplicateText(about);
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

// Main function to make activity API call
async function makeActivityApiCall(topicEngData) {
  try {
    // Validate that we have the required data
    if (
      !topicEngData.business_id ||
      !topicEngData.topic_id ||
      !topicEngData.contact_id
    ) {
      console.error("Missing required topic engagement data:", topicEngData);
      return;
    }

    await chrome.runtime.sendMessage({
      action: "MAKE_ACTIVITY_API_CALL",
      payload: {
        activityId: topicEngData?.last_activity_id,
        businessId: topicEngData.business_id,
        engagement_type: "visit",
        segmentId: topicEngData.topic_id,
        customerId: topicEngData.contact_id,

        isAutoPost: autoPostEnabled,
      },
    });

    console.log("Activity API call completed successfully");
  } catch (error) {
    console.error("Error making activity API call:", error);
    await setToChromeStorage("topic_eng_data", {});

    chrome.runtime.sendMessage({
      action: "DELAYED_FEED_REDIRECT",
      minDelay,
      maxDelay,
      url: await getRandomTopicUrl(),
    });
  }
}

// Main function to update contact
async function updateContactAction() {
  try {
    const { firstName, lastName } = getFirstLastName();
    const address = getAddress();
    const jobTitle = getJobTitle();
    const avatar = getAvatar();
    const about = getAbout();
    const education = getEducation();
    const experience = getExperience();
    const skills = getSkills();

    // Create summary JSON object
    const summary = JSON.stringify({
      about: about,
      education: education,
      experience: experience,
      skills: skills,
    });

    const topicEngData = await getFromChromeStorage("topic_eng_data", {});

    // Validate that we have the required data
    if (!topicEngData.business_id || !topicEngData.contact_id) {
      console.error("Missing required topic engagement data:", topicEngData);
      return;
    }

    const contactData = {
      address: address || "",
      jobTitle: jobTitle || "",
      avatar: avatar || "",
      contact_id: topicEngData.contact_id,
      business_id: topicEngData.business_id,
      summary: summary,
    };
    await chrome.runtime.sendMessage({
      action: "UPDATE_CONTACT_ACTION",
      data: contactData,
    });

    console.log("Contact update completed successfully", contactData);
  } catch (error) {
    console.error("Error updating contact:", error);
    await setToChromeStorage("topic_eng_data", {});

    chrome.runtime.sendMessage({
      action: "DELAYED_FEED_REDIRECT",
      minDelay,
      maxDelay,
      url: await getRandomTopicUrl(),
    });
  }
}

// Main initialization function
// Main initialization function
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

    // Get current page URL
    const currentPageUrl = getCurrentProfileUrl();

    console.log("Current page URL:", currentPageUrl);
    console.log(
      "Poster profile URL from storage:",
      topicEngData.posterProfileUrl
    );

    // Only proceed if the current page URL matches the poster profile URL
    const normalizedPosterUrl = topicEngData.posterProfileUrl.replace(
      /\/$/,
      ""
    );
    const normalizedCurrentUrl = currentPageUrl.replace(/\/$/, "");

    if (normalizedPosterUrl === normalizedCurrentUrl) {
      console.log("URLs match - proceeding with profile engagement");

      // 1. Make activity API call with type "visit"
      await makeActivityApiCall(topicEngData);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 2. Update contact action with scraped data
      await updateContactAction();

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
    await setToChromeStorage("topic_eng_data", {});

    chrome.runtime.sendMessage({
      action: "DELAYED_FEED_REDIRECT",
      minDelay,
      maxDelay,
      url: await getRandomTopicUrl(),
    });
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
