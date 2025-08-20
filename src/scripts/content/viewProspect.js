// Import Prospect Button & Drawer Content Script (self-contained)

const { getPosterName, getPosterProfile } = require("../../utils/utils");
const { showNotification } = require("../../utils/notification");
const {
  APIURL,
  connectionReqSystemImpportPrompt,
  connectionReqUserImpportPrompt,
  anlyzerSystemPrompt,
} = require("../../utils/constant");

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

(function () {
  // Inject custom styles for the drawer and its contents (with accordion styles)
  function injectDrawerStyles() {
    if (document.getElementById("mp-import-drawer-style")) return;
    const style = document.createElement("style");
    style.id = "mp-import-drawer-style";
    style.textContent = `
    .mp-import-drawer-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 99998; 
      transition: opacity 0.3s ease-in-out;
    }
    .mp-import-drawer {
      position: fixed; top: 0; right: 0; width: 380px; height: 100vh; background: #ffffff;
      box-shadow: rgba(0,0,0,0.1) -4px 0px 12px; z-index: 99999;
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94);
    }
    .mp-import-drawer-open { transform: translateX(0); }
    .mp-import-drawer-closed { transform: translateX(100%); }
    .mp-import-drawer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px 12px 20px; border-bottom: 1px solid #e5e7eb;
      background: #ffffff;
    }
    .mp-import-drawer-logo-title { display: flex; align-items: center; gap: 8px; }
    .mp-import-drawer-logo { width: 32px; height: 32px; border-radius: 6px; }
    .mp-import-drawer-title { font-size: 1.4rem; font-weight: 600; color: #1f2937; }
    .mp-import-drawer-close {
      background: #f9fafb; border: 1px solid #e5e7eb; cursor: pointer; 
      padding: 6px; border-radius: 6px; width: 30px; height: 30px; 
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .mp-import-drawer-close:hover { background: #f3f4f6; }
    .mp-import-drawer-close svg { width: 16px; height: 16px; color: #374151; }
    .mp-import-drawer-main {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px;
      background: #ffffff;
    }

    /* Simplified User Info */
    .mp-user-info {
      display: flex; align-items: center; gap: 12px; margin-bottom: 8px;
      padding: 0; /* Remove card styling */
    }
    .mp-user-avatar {
      width: 44px; height: 44px; border-radius: 8px; object-fit: cover; 
      background: #f3f4f6; border: 1px solid #e5e7eb;
    }
    .mp-user-meta h4 {
      font-size: 1.2rem; font-weight: 600; color: #111827; margin: 0; line-height: 1.3;
    }
    .mp-user-meta p {
      font-size: 0.9rem; color: #6b7280; margin: 2px 0 0 0; line-height: 1.4;
    }

    /* Simplified Accordion - Remove Card Style */
    .mp-accordion {
      border: none; border-radius: 0; margin-bottom: 10px; 
      overflow: hidden; background: transparent;
      box-shadow: none; border-bottom: 1px solid #f3f4f6;
    }
    .mp-accordion:hover { box-shadow: none; }
    .mp-accordion-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0px; background: transparent;
      cursor: pointer; border-bottom: none;
      transition: all 0.2s ease;
    }
    .mp-accordion-header::before { display: none; }
    .mp-accordion-header:hover { background: transparent; }
    .mp-accordion-header.active { background: transparent; }
    .mp-accordion-title {
      font-size: 1.5rem; font-weight: 600; color: #111827;
      display: flex; align-items: center; gap: 8px;
    }
    .mp-accordion-title::before { display: none; }
    .mp-accordion-icon {
      width: 18px; height: 18px; transition: all 0.2s ease;
      color: #6b7280;
    }
    .mp-accordion-icon.rotated { transform: rotate(180deg); color: #374151; }
    .mp-accordion-content {
      padding: 12px 0px 16px 0px; display: none; background: transparent;
      animation: fadeIn 0.2s ease-in-out;
    }
    .mp-accordion-content.active { display: block; }

    /* Simplified Form Elements */
    .mp-import-drawer-label {
      font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; 
      margin-top: 0; display: block;
    }
    .mp-import-drawer-textarea, .mp-message-textarea {
      width: 100%; border: 1px solid #d1d5db; border-radius: 6px;
      font-size: 14px; font-family: inherit; background: #ffffff;
      transition: border-color 0.2s ease;
    }
    .mp-import-drawer-textarea:focus, .mp-message-textarea:focus {
      outline: none; border-color: #3b82f6; 
    }
    .mp-message-textarea {
       resize: vertical; min-height: 180px;
    }

    /* Improved Button Styling */
    .mp-import-drawer-btn {
      flex: 1; font-size: 14px; font-weight: 600; border-radius: 6px;
      padding: 10px 16px; cursor: pointer; transition: all 0.2s ease;
      border: none; text-align: center;
    }
    .mp-import-drawer-btn-primary {
      background: #101112; color: #fff; 
    }
    .mp-import-drawer-btn-primary:hover { 
      background: #101112;
    }
    .mp-import-drawer-btn-secondary {
      background: #f9fafb; color: #374151; border: 1px solid #d1d5db; 
    }
    .mp-import-drawer-btn-secondary:hover {
      background: #f3f4f6; border-color: #9ca3af;
    }

    /* Improved Generate/Action Buttons */
    .mp-generate-btn {
      background: #101112; color: #fff; border: none;
      padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background 0.2s ease; margin-top: 8px;
    }
    .mp-generate-btn:hover { background: #101112; }
    .mp-generate-btn:disabled {
      background: #9ca3af; cursor: not-allowed;
    }

    .mp-copy-btn {
      background: #6b7280; color: #fff; border: none;
      padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;
      transition: background 0.2s ease; font-weight: 500;
    }
    .mp-copy-btn:hover { background: #4b5563; }

    /* Simplified Generated Message */
    .mp-generated-message {
      margin-top: 12px; padding: 12px; background: #f0fdf4;
      border: 1px solid #bbf7d0; border-radius: 6px; display: none;
    }
    .mp-generated-message.active { display: block; }
    .mp-generated-text {
      font-size: 14px; color: #065f46; margin-bottom: 8px; line-height: 1.4;
    }

    /* Simplified Success Message */
    .mp-import-drawer-success-msg {
      margin-top: 8px; color: #059669; font-size: 14px; font-weight: 500; 
      display: none; text-align: center; padding: 8px; border-radius: 6px;
      background: #f0fdf4;
    }
    .mp-import-drawer-success-msg.active { display: block; }

    /* Simplified Spinner */
    .mp-import-spinner {
      display: inline-block; vertical-align: middle; width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,0.3); border-right-color: #ffffff;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }

    /* Remove Card Styling from Create List Form */
    .mp-import-create-list-form {
      margin-top: 12px !important; background: #f9fafb !important;
      padding: 12px !important; border-radius: 6px !important; 
      border: 1px solid #e5e7eb !important;
    }
    .mp-import-create-list-form::before { display: none; }

    /* Section Spacing */
    .mp-import-section, .mp-connection-section, .mp-profile-match-section {
      margin-bottom: 14px;
    }
    .mp-import-section:last-child, .mp-connection-section:last-child, 
    .mp-profile-match-section:last-child {
      margin-bottom: 0;
    }

    /* Improved Create List Button */
    #mp-create-list-btn {
    
    
      color: #374151 !important;
      border-radius: 6px !important;
      font-size: 12px !important; 
      height: 28px !important;
      cursor: pointer !important;
      margin-bottom:5px;
      padding: 0 8px !important;
      font-weight: 500 !important;
      transition: all 0.2s ease !important;
    }
    #mp-create-list-btn:hover {
      background: #f3f4f6 !important;
      border-color: #9ca3af !important;
    }

    /* Clean Button Row */
    .mp-import-drawer-btn-row { 
      display: flex; gap: 10px; margin-top: 8px; 
    }

    /* Responsive adjustments */
    @media (max-width: 480px) {
      .mp-import-drawer { width: 100vw; }
      .mp-import-drawer-main { padding: 16px; }
    }
  `;
    document.head.appendChild(style);
  }

  // Utility functions for extracting profile data
  function getAvatar() {
    const selectors = [
      ".pv-top-card-profile-picture__image",
      ".pv-top-card__photo img",
      ".EntityPhoto-circle-9 img",
    ];
    for (const selector of selectors) {
      const img = document.querySelector(selector);
      if (img && img.src) return img.src;
    }
    return "";
  }

  function getJobTitle() {
    const selectors = [
      ".text-body-medium.break-words[data-generated-suggestion-target]",
      ".pv-text-details__left-panel .text-body-medium",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (
        el &&
        el.textContent &&
        !el.textContent.includes("followers") &&
        !el.textContent.includes("connections")
      ) {
        return el.textContent.trim();
      }
    }
    return "";
  }

  function getAddress() {
    const selectors = [
      ".text-body-small.inline.t-black--light.break-words",
      ".pv-text-details__left-panel .text-body-small",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (
        el &&
        el.textContent.includes(",") &&
        !el.textContent.includes("followers") &&
        !el.textContent.includes("connections")
      ) {
        return el.textContent.trim();
      }
    }
    return "";
  }

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
        const companyText = cleanDuplicateText(
          companyElement.textContent.trim()
        );
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

  // Extract user info function with extra fields
  function extractUserInfoWithExtras() {
    // Get name from profile page
    const nameEl =
      document.querySelector("h1.text-heading-xlarge") ||
      document.querySelector("h1.inline.t-24.v-align-middle.break-words");
    const name = nameEl ? nameEl.textContent.trim() : "";

    // Get profile URL
    const profile = window.location.href;

    // Get avatar from profile page or generate
    let avatar = getAvatar();
    if (!avatar && name) {
      avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
    }

    // Parse name into first/last
    let first_name = "",
      last_name = "";
    if (name) {
      const parts = name.split(" ");
      first_name = parts[0] || "";
      last_name = parts.slice(1).join(" ") || "";
    }

    const safeGetValue = (fn, fieldName) => {
      try {
        const value = fn();
        return value || "";
      } catch (error) {
        console.log(`Failed to get ${fieldName}:`, error);
        return "";
      }
    };

    // Get extra fields
    const current_job_title = getJobTitle();
    const address = getAddress();

    const about = safeGetValue(getAbout, "about");
    const education = safeGetValue(getEducation, "education");
    const experience = safeGetValue(getExperience, "experience");
    const skills = safeGetValue(getSkills, "skills");

    const summaryData = {};
    if (about) summaryData.about = about;
    if (education) summaryData.education = education;
    if (experience) summaryData.experience = experience;
    if (skills) summaryData.skills = skills;

    const summary = JSON.stringify(summaryData);

    return {
      name,
      profile,
      avatar,
      info: current_job_title, // Use job title as info
      current_job_title,
      summary,
      address, // Extra field
      first_name,
      last_name,
    };
  }

  // New function to create accordion structure
  function createAccordion(id, title, content, isOpen = false) {
    const accordion = document.createElement("div");
    accordion.className = "mp-accordion";

    accordion.innerHTML = `
    <div class="mp-accordion-header ${
      isOpen ? "active" : ""
    }" data-accordion="${id}">
      <span class="mp-accordion-title">${title}</span>
      <svg class="mp-accordion-icon ${
        isOpen ? "rotated" : ""
      }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
      </svg>
    </div>
    <div class="mp-accordion-content ${
      isOpen ? "active" : ""
    }" id="${id}-content">
      ${content}
    </div>
  `;

    const header = accordion.querySelector(".mp-accordion-header");
    const contentDiv = accordion.querySelector(".mp-accordion-content");
    const icon = accordion.querySelector(".mp-accordion-icon");

    header.onclick = () => {
      const isCurrentlyOpen = contentDiv.classList.contains("active");

      // Close all accordions
      document
        .querySelectorAll(".mp-accordion-content.active")
        .forEach((c) => c.classList.remove("active"));
      document
        .querySelectorAll(".mp-accordion-header")
        .forEach((h) => h.classList.remove("active"));
      document
        .querySelectorAll(".mp-accordion-icon")
        .forEach((i) => i.classList.remove("rotated"));

      // Open clicked accordion if it wasn't open
      if (!isCurrentlyOpen) {
        contentDiv.classList.add("active");
        header.classList.add("active");
        icon.classList.add("rotated");
      }
    };

    return accordion;
  }

  // Generate connection request message function
  async function generateConnectionRequestMessage(userQuery) {
    try {
      // Extract profile data using existing functions
      const userInfo = extractUserInfoWithExtras();
      const firstName = userInfo.first_name;
      const lastName = userInfo.last_name;
      const jobTitle = userInfo.current_job_title;
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

      // Build dynamic prompt based on available data
      let profileInfo = `Name: ${firstName} ${lastName}`.trim();

      if (hasJobTitle) {
        profileInfo += `\nJob Title: ${jobTitle}`;
      }

      if (hasAbout) {
        profileInfo += `\nAbout: ${about.substring(0, 200)}`;
      }

      const systemPrompt = connectionReqSystemImpportPrompt;

      const userPrompt = `${userQuery}
Generate a professional LinkedIn connection request message for:
${profileInfo}`;

      const body = JSON.stringify({
        model: "llama3.1:latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        options: {
          max_token: 100,
          repeat_penalty: 1.2,
          temperature: 0.7,
        },
      });

      // Get token and make API call
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

      const generatedMessage = data.data?.data || data.message;

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
      return cleanMessage;
    } catch (error) {
      console.error("Error generating connection request message:", error);
      return null;
    }
  }

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

  // Generate profile match function
  async function generateProfileMatch(userQuery) {
    try {
      const userInfo = extractUserInfoWithExtras();
      const firstName = userInfo.first_name;
      const lastName = userInfo.last_name;
      const jobTitle = userInfo.current_job_title;
      const about = getAbout();

      const systemPrompt = anlyzerSystemPrompt;

      const userPrompt = `Analyze this LinkedIn profile against the criteria: "${userQuery}"

Profile Data:
Name: ${firstName} ${lastName}
Job Title: ${jobTitle || "Not available"}
About: ${about ? about.substring(0, 300) : "Not available"}

Provide a match analysis with percentage and reasoning.`;

      const body = JSON.stringify({
        model: "llama3.1:latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        options: {
          max_token: 200,
          repeat_penalty: 1.2,
          temperature: 0.3,
        },
      });

      const serverUrl = `${APIURL}/ai/chat`;
      const data = await callApi({
        action: "API_POST_GENERATE_MESSAGE",
        url: serverUrl,
        method: "POST",
        body,
      });

      if (data.error) {
        console.error("GPT API error:", data.error);
        return null;
      }

      const generatedMatch = data.data?.data || data.message;
      return generatedMatch ? generatedMatch.trim() : null;
    } catch (error) {
      console.error("Error generating profile match:", error);
      return null;
    }
  }

  // Copy to clipboard function
  function copyToClipboard(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showNotification("Copied to clipboard!", "success");
      })
      .catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand("copy");
          showNotification("Copied to clipboard!", "success");
        } catch (err) {
          showNotification("Failed to copy", "error");
        }
        document.body.removeChild(textArea);
      });
  }

  // Main showImportDrawer function with all accordions
  function showImportDrawer() {
    injectDrawerStyles();
    // Remove any existing drawer
    const existing = document.getElementById("mp-import-drawer");
    if (existing) existing.remove();
    const overlay = document.getElementById("mp-import-overlay");
    if (overlay) overlay.remove();

    // Find main LinkedIn feed container
    let parent = document.querySelector("div.feed-outlet, main, #main, body");
    if (!parent) parent = document.body;

    // Overlay
    const overlayDiv = document.createElement("div");
    overlayDiv.id = "mp-import-overlay";
    overlayDiv.className = "mp-import-drawer-overlay";
    overlayDiv.onclick = closeDrawer;
    parent.appendChild(overlayDiv);

    // Drawer
    const drawer = document.createElement("div");
    drawer.id = "mp-import-drawer";
    drawer.className = "mp-import-drawer mp-import-drawer-closed";

    // Header
    const header = document.createElement("div");
    header.className = "mp-import-drawer-header";

    const logoTitle = document.createElement("div");
    logoTitle.className = "mp-import-drawer-logo-title";
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL("assets/logo_48.png");
    logo.alt = "ManagePlus Logo";
    logo.className = "mp-import-drawer-logo";
    const title = document.createElement("span");
    title.textContent = "ManagePlus Tools";
    title.className = "mp-import-drawer-title";
    logoTitle.appendChild(logo);
    logoTitle.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L14 14M14 6L6 14" stroke="#222" stroke-width="2" stroke-linecap="round"/></svg>`;
    closeBtn.className = "mp-import-drawer-close";
    closeBtn.onclick = closeDrawer;
    header.appendChild(logoTitle);
    header.appendChild(closeBtn);
    drawer.appendChild(header);

    // Main content
    const main = document.createElement("div");
    main.className = "mp-import-drawer-main";

    // User info
    const userInfo = extractUserInfoWithExtras();
    const userInfoDiv = document.createElement("div");
    userInfoDiv.className = "mp-user-info";
    userInfoDiv.innerHTML = `
      <img class="mp-user-avatar" style="height:40px; width:40px; border-radius:50%; object-fit:cover; background:#f3f4f6;" src="${
        userInfo.avatar
      }" alt="${userInfo.name || "Avatar"}" 
           onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(
             userInfo.name || "User"
           )}'">
      <div class="mp-user-meta">
        <h3>${userInfo.name}</h3>
        <p style="font-size:12px;">${userInfo.current_job_title}</p>
      </div>
    `;
    main.appendChild(userInfoDiv);

    // Create Import Prospect Accordion Content
    const importContent = `
      <div class="mp-import-section">
        <label class="mp-import-drawer-label">Board</label>
        <select id="mp-board-select" class="mp-import-drawer-textarea"></select>
      </div>
      <div class="mp-import-section">
        <label class="mp-import-drawer-label">Contact Type</label>
        <select id="mp-contact-type-select" class="mp-import-drawer-textarea"></select>
      </div>
      <div class="mp-import-section">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <label class="mp-import-drawer-label">List</label>
          <button type="button" id="mp-create-list-btn" style="border:none;color:#101112;border-radius:7px;font-size:13px;height:32px;cursor:pointer;">Create List</button>
        </div>
        <select id="mp-list-select" class="mp-import-drawer-textarea"></select>
      </div>
      <div class="mp-import-drawer-btn-row">
        <button type="button" id="mp-import-btn" class="mp-import-drawer-btn mp-import-drawer-btn-primary">Import</button>
      </div>
      <div id="mp-import-success-msg" class="mp-import-drawer-success-msg">Imported successfully!</div>
      <div id="mp-login-required" style="display:none;margin:32px 0 0 0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px 18px;text-align:center;">
        <div style="font-size:1.25rem;font-weight:700;margin-bottom:10px;">Login required</div>
        <div style="font-size:1rem;color:#666;font-weight:400;margin-bottom:18px;">To import this prospect you need to login to our platform ManagePlus.</div>
        <button id="mp-login-btn" style="background:#101112;color:#fff;font-weight:600;padding:10px 24px;border:none;border-radius:7px;cursor:pointer;font-size:1rem;">Login to ManagePlus</button>
      </div>
    `;

    // Create Connection Message Accordion Content
    const connectionContent = `
      <div class="mp-connection-section">
        <label class="mp-import-drawer-label">Connection Request Message Prompt</label>
        <textarea id="mp-connection-textarea" class="mp-message-textarea" placeholder="Enter your prompt to generate message...">${
          connectionReqUserImpportPrompt || ""
        }</textarea>
        <button type="button" id="mp-generate-connection-btn" class="mp-generate-btn">Generate Message</button>
        <div id="mp-generated-connection" class="mp-generated-message">
          <div id="mp-generated-connection-text" class="mp-generated-text"></div>
          <button type="button" id="mp-copy-connection-btn" class="mp-copy-btn">Copy Message</button>
        </div>
      </div>
    `;

    // Create Profile Match Accordion Content
    const profileMatchContent = `
      <div class="mp-profile-match-section">
        <label class="mp-import-drawer-label">Profile Match Criteria Prompt</label>
        <textarea id="mp-profile-match-textarea" class="mp-message-textarea" placeholder="Enter your criteria (e.g., 'Check if user is related to software industry', 'Looking for marketing professionals', etc.)"></textarea>
        <button type="button" id="mp-generate-match-btn" class="mp-generate-btn">Analyze Profile</button>
        <div id="mp-generated-match" class="mp-generated-message">
          <div id="mp-generated-match-text" class="mp-generated-text"></div>
          <button type="button" id="mp-copy-match-btn" class="mp-copy-btn">Copy Analysis</button>
        </div>
      </div>
    `;

    // Create accordions
    const importAccordion = createAccordion(
      "import-prospect",
      "Import Prospect",
      importContent,
      true
    );
    const connectionAccordion = createAccordion(
      "connection-message",
      "Draft Connection Request Message",
      connectionContent,
      false
    );
    const profileMatchAccordion = createAccordion(
      "profile-match",
      "Profile Match",
      profileMatchContent,
      false
    );

    main.appendChild(importAccordion);
    main.appendChild(connectionAccordion);
    main.appendChild(profileMatchAccordion);

    drawer.appendChild(main);
    parent.appendChild(drawer);

    // Animate in
    setTimeout(() => {
      drawer.classList.remove("mp-import-drawer-closed");
      drawer.classList.add("mp-import-drawer-open");
      overlayDiv.classList.remove("opacity-0");
    }, 10);

    // Close logic
    function closeDrawer() {
      drawer.classList.remove("mp-import-drawer-open");
      drawer.classList.add("mp-import-drawer-closed");
      overlayDiv.classList.add("opacity-0");
      setTimeout(() => {
        if (drawer.parentNode) drawer.remove();
        if (overlayDiv.parentNode) overlayDiv.remove();
      }, 300);
    }

    // Helper to get token from background
    async function getTokenFromBackground() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response) => {
          if (response && response.token) {
            resolve(response.token);
          } else {
            resolve(null);
          }
        });
      });
    }

    // Initialize Import Prospect functionality
    function initializeImportProspect() {
      const boardSelect = document.getElementById("mp-board-select");
      const contactTypeSelect = document.getElementById(
        "mp-contact-type-select"
      );
      const listSelect = document.getElementById("mp-list-select");
      const importBtn = document.getElementById("mp-import-btn");
      const createListBtn = document.getElementById("mp-create-list-btn");
      const loginRequired = document.getElementById("mp-login-required");
      const successMsg = document.getElementById("mp-import-success-msg");

      // Login required logic
      let loginMsgDiv = null;
      function showLoginRequired() {
        // Hide all main inputs
        boardSelect.parentElement.style.display = "none";
        contactTypeSelect.parentElement.style.display = "none";
        listSelect.parentElement.parentElement.style.display = "none";
        importBtn.parentElement.style.display = "none";
        if (!loginMsgDiv) {
          loginMsgDiv = loginRequired;
          loginMsgDiv.style.display = "";
          loginMsgDiv.querySelector("#mp-login-btn").onclick = function () {
            const { WEBURL } = require("../../utils/constant");
            window.open(WEBURL, "_blank");
          };
        } else {
          loginMsgDiv.style.display = "";
        }
      }

      function hideLoginRequired() {
        boardSelect.parentElement.style.display = "";
        contactTypeSelect.parentElement.style.display = "";
        listSelect.parentElement.parentElement.style.display = "";
        importBtn.parentElement.style.display = "";
        if (loginMsgDiv) loginMsgDiv.style.display = "none";
      }

      // Fetch boards, contact types, and lists
      async function fetchBoardsAndPopulate() {
        const token = await getTokenFromBackground();
        if (!token) {
          showLoginRequired();
          return;
        } else {
          hideLoginRequired();
        }

        chrome.runtime.sendMessage(
          { action: "FETCH_BOARDS_BG", token },
          (boards) => {
            if (!boards || !boards.success) {
              boardSelect.innerHTML = `<option value="">No boards found</option>`;
              return;
            }
            if (
              typeof require("../../utils/utils").populateBoards === "function"
            ) {
              require("../../utils/utils").populateBoards(
                boardSelect,
                boards.data
              );
            }
            // Fetch contact types and lists for the first board
            if (boardSelect.value) {
              fetchContactTypesAndLists(token, boardSelect.value);
            }
          }
        );
      }

      async function fetchContactTypesAndLists(token, boardId) {
        chrome.runtime.sendMessage(
          { action: "FETCH_CONTACT_TYPES_BG", token, businessId: boardId },
          (data) => {
            if (
              typeof require("../../utils/utils").populateContactType ===
              "function"
            ) {
              require("../../utils/utils").populateContactType(
                contactTypeSelect,
                data.data
              );
            }
          }
        );

        chrome.runtime.sendMessage(
          { action: "FETCH_SEGMENT_LIST_BG", token, businessId: boardId },
          (data) => {
            if (
              typeof require("../../utils/utils").populateListType ===
              "function"
            ) {
              require("../../utils/utils").populateListType(
                listSelect,
                data.data
              );
            }
          }
        );
      }

      boardSelect.addEventListener("change", async () => {
        const token = await getTokenFromBackground();
        fetchContactTypesAndLists(token, boardSelect.value);
      });

      fetchBoardsAndPopulate();

      // Create List Form Logic
      let createListForm = null;
      createListBtn.onclick = async function () {
        if (createListForm) return;

        const listSection = listSelect.parentElement;
        const listLabelRow = listSection.querySelector("div");

        listLabelRow.style.display = "none";
        listSelect.style.display = "none";

        createListForm = document.createElement("div");
        createListForm.className = "mp-import-create-list-form";
        createListForm.style.marginTop = "10px";
        createListForm.style.background = "#f9f9f9";
        createListForm.style.padding = "14px";
        createListForm.style.borderRadius = "8px";
        createListForm.style.border = "1px solid #e5e7eb";
        createListForm.innerHTML = `
          <div style="margin-bottom:8px;font-weight:600;">Create New List</div>
          <div style="margin-bottom:8px;">
            <input type="text" id="mp-import-new-list-name" placeholder="List Name" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #ccc;" />
          </div>
          <div style="margin-bottom:8px;">
            <textarea id="mp-import-new-list-prompt" rows="3" placeholder="Engagement Prompt (optional)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #ccc;"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button type="button" id="mp-import-cancel-list-btn" class="mp-import-drawer-btn mp-import-drawer-btn-secondary">Cancel</button>
            <button type="button" id="mp-import-save-list-btn" class="mp-import-drawer-btn mp-import-drawer-btn-primary">Save</button>
          </div>
          <div id="mp-import-create-list-error" style="color:#e11d48;font-size:13px;margin-top:6px;display:none;"></div>
        `;
        listSection.appendChild(createListForm);

        // Cancel logic
        createListForm.querySelector("#mp-import-cancel-list-btn").onclick =
          function () {
            createListForm.remove();
            createListForm = null;
            listLabelRow.style.display = "flex";
            listSelect.style.display = "";
          };

        // Save logic
        createListForm.querySelector("#mp-import-save-list-btn").onclick =
          async function () {
            const saveBtn = createListForm.querySelector(
              "#mp-import-save-list-btn"
            );
            saveBtn.disabled = true;
            const originalText = saveBtn.textContent;
            saveBtn.innerHTML = `<span class='mp-import-spinner' style='display:inline-block;vertical-align:middle;margin-right:8px;width:18px;height:18px;border:2.5px solid #fff;border-right-color:transparent;border-radius:50%;animation:mp-spin 0.7s linear infinite;'></span>Saving...`;

            const name = createListForm
              .querySelector("#mp-import-new-list-name")
              .value.trim();
            const prompt = createListForm
              .querySelector("#mp-import-new-list-prompt")
              .value.trim();
            const errorDiv = createListForm.querySelector(
              "#mp-import-create-list-error"
            );

            errorDiv.style.display = "none";
            errorDiv.textContent = "";

            if (!name) {
              errorDiv.textContent = "List Name is required.";
              errorDiv.style.display = "block";
              saveBtn.disabled = false;
              saveBtn.textContent = originalText;
              return;
            }

            const token = await getTokenFromBackground();
            if (!token) {
              errorDiv.textContent =
                "Authentication failed. Please log in again.";
              errorDiv.style.display = "block";
              saveBtn.disabled = false;
              saveBtn.textContent = originalText;
              return;
            }

            if (!boardSelect.value) {
              errorDiv.textContent = "Please select a board.";
              errorDiv.style.display = "block";
              saveBtn.disabled = false;
              saveBtn.textContent = originalText;
              return;
            }

            const {
              APIURL,
              DEFAULT_SETTINGS,
            } = require("../../utils/constant");
            const payload = {
              name: name,
              type: 1,
              archive_date: new Date().toISOString(),
              engagement_prompt: prompt
                ? prompt
                : DEFAULT_SETTINGS
                ? DEFAULT_SETTINGS.userPrompt
                : "",
            };

            try {
              const response = await fetch(`${APIURL}/segmentation`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "b-id": boardSelect.value,
                },
                body: JSON.stringify(payload),
              });

              if (!response.ok) {
                let errorData = { message: `HTTP error ${response.status}` };
                try {
                  const responseBody = await response.json();
                  errorData.message =
                    responseBody.message ||
                    responseBody.error ||
                    (responseBody.errors &&
                      responseBody.errors[
                        Object.keys(responseBody.errors)[0]
                      ][0]) ||
                    errorData.message;
                } catch (e) {
                  errorData.message = response.statusText || errorData.message;
                }
                errorDiv.textContent = `Error creating list: ${errorData.message}`;
                errorDiv.style.display = "block";
                saveBtn.disabled = false;
                saveBtn.textContent = originalText;
                return;
              }

              // Success: refresh list select
              createListForm.remove();
              createListForm = null;
              listLabelRow.style.display = "flex";
              listSelect.style.display = "";

              // Refresh lists and select the new one
              await fetchContactTypesAndLists(token, boardSelect.value);
              setTimeout(() => {
                for (let i = 0; i < listSelect.options.length; i++) {
                  if (listSelect.options[i].textContent === name) {
                    listSelect.selectedIndex = i;
                    break;
                  }
                }
              }, 500);
            } catch (error) {
              errorDiv.textContent =
                "Failed to create list due to a network or unexpected error.";
              errorDiv.style.display = "block";
              saveBtn.disabled = false;
              saveBtn.textContent = originalText;
            }
          };
      };

      // Import button logic
      importBtn.onclick = async () => {
        const authToken = await getTokenFromBackground();
        if (!authToken) {
          showNotification("Failed to get auth token", "error");
          return;
        }

        if (!boardSelect.value) {
          showNotification("Please select a board.", "error");
          return;
        }
        if (!contactTypeSelect.value) {
          showNotification("Please select a contact type.", "error");
          return;
        }
        if (!listSelect.value) {
          showNotification("Please select a list.", "error");
          return;
        }

        importBtn.innerHTML = `<span class='mp-import-spinner'></span> Importing...`;

        // Prepare data for import
        const user = userInfo;
        const row = {
          first_name: user.first_name,
          last_name: user.last_name,
          current_job_title: userInfo?.current_job_title,
          summary: userInfo?.summary,
          avatar: user.avatar,
          mp_customer_linkedin_profile: user.profile,
        };

        // Call background to import
        chrome.runtime.sendMessage(
          {
            action: "saveScrapedData",
            metadata: {
              prospects: [row],
              authToken,
              contact_type: contactTypeSelect.value,
              board: boardSelect.value,
              segment_list: listSelect.value,
            },
          },
          (result) => {
            importBtn.textContent = "Import";
            if (result && result.status === "success") {
              successMsg.classList.add("active");
              showNotification("Prospect imported successfully!", "success");
              setTimeout(() => {
                successMsg.classList.remove("active");
                closeDrawer();
              }, 1200);
            } else {
              showNotification(result?.error || "Import failed", "error");
            }
          }
        );
      };
    }

    // Initialize Connection Message functionality
    function initializeConnectionMessage() {
      const generateBtn = document.getElementById("mp-generate-connection-btn");
      const textarea = document.getElementById("mp-connection-textarea");
      const generatedDiv = document.getElementById("mp-generated-connection");
      const generatedText = document.getElementById(
        "mp-generated-connection-text"
      );
      const copyBtn = document.getElementById("mp-copy-connection-btn");

      generateBtn.onclick = async () => {
        const userQuery = textarea.value.trim();

        if (!userQuery) {
          showNotification("Please enter your prompt first.", "error");
          return;
        }

        generateBtn.disabled = true;
        generateBtn.innerHTML =
          '<span class="mp-import-spinner"></span> Generating...';

        try {
          const message = await generateConnectionRequestMessage(userQuery);

          if (message) {
            // textarea.value = message;
            generatedText.textContent = message;
            generatedDiv.classList.add("active");
            showNotification("Connection message generated!", "success");
          } else {
            showNotification(
              "Unable to generate message. Please try again.",
              "error"
            );
          }
        } catch (error) {
          console.error("Error generating connection message:", error);
          showNotification(
            "Error generating message. Please try again.",
            "error"
          );
        } finally {
          generateBtn.disabled = false;
          generateBtn.textContent = "Generate Message";
        }
      };

      copyBtn.onclick = () => {
        const text = generatedText.textContent;
        if (text) {
          copyToClipboard(text);
        }
      };
    }

    // Initialize Profile Match functionality
    function initializeProfileMatch() {
      const generateBtn = document.getElementById("mp-generate-match-btn");
      const textarea = document.getElementById("mp-profile-match-textarea");
      const generatedDiv = document.getElementById("mp-generated-match");
      const generatedText = document.getElementById("mp-generated-match-text");
      const copyBtn = document.getElementById("mp-copy-match-btn");

      generateBtn.onclick = async () => {
        const userQuery = textarea.value.trim();

        if (!userQuery) {
          showNotification("Please enter your criteria first.", "error");
          return;
        }

        generateBtn.disabled = true;
        generateBtn.innerHTML =
          '<span class="mp-import-spinner"></span> Analyzing...';

        try {
          const analysis = await generateProfileMatch(userQuery);

          if (analysis) {
            generatedText.textContent = analysis;
            generatedDiv.classList.add("active");
            showNotification("Profile analysis completed!", "success");
          } else {
            showNotification(
              "Unable to analyze profile. Please try again.",
              "error"
            );
          }
        } catch (error) {
          console.error("Error generating profile match:", error);
          showNotification(
            "Error analyzing profile. Please try again.",
            "error"
          );
        } finally {
          generateBtn.disabled = false;
          generateBtn.textContent = "Analyze Profile";
        }
      };

      copyBtn.onclick = () => {
        const text = generatedText.textContent;
        if (text) {
          copyToClipboard(text);
        }
      };
    }

    // Initialize all accordion functionalities
    initializeImportProspect();
    initializeConnectionMessage();
    initializeProfileMatch();
  }

  // Utility functions for button injection
  function isLinkedInProfile() {
    return (
      window.location.pathname.includes("/in/") &&
      window.location.hostname === "www.linkedin.com"
    );
  }

  // Inject Import Prospect button
  function injectImportButton() {
    if (!isLinkedInProfile()) {
      return;
    }

    // Check if button already exists
    if (document.querySelector("#mp-view-prospect-btn")) {
      return;
    }

    const stickyHeaderToggle = document.querySelector(
      "#profile-sticky-header-toggle"
    );
    if (!stickyHeaderToggle) return;

    // Get the previous div of profile-sticky-header-toggle
    const prevDiv = stickyHeaderToggle.previousElementSibling;
    if (!prevDiv) return;

    // Find all div elements inside the previous div
    const divs = prevDiv.querySelectorAll("div");
    if (divs.length === 0) return;

    // Get the last div inside the previous div
    const lastDiv = divs[divs.length - 1];
    if (!lastDiv || lastDiv.querySelector("#mp-view-prospect-btn")) return;

    const btn = document.createElement("button");
    btn.id = "mp-view-prospect-btn";
    btn.textContent = "View Prospect";
    btn.style.cssText = `
    background: #101112;
    color: #fff;
    padding: 6px 16px;
    border-radius: 25px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    margin-left: 4px;
  `;

    btn.onclick = (e) => {
      e.stopPropagation();
      showImportDrawer();
    };

    lastDiv.appendChild(btn);
  }
  // Profile page support functions
  function extractProfileInfoFromCustomCard() {
    const card = document.querySelector(".ypwoaoNsuEsRQhEuYAVqNMLekgvYevJfkEk");
    if (!card) return null;

    const nameTag = card.querySelector("h1");
    const name = nameTag ? nameTag.textContent.trim() : "";

    const linkTag = card.querySelector('a[href*="/in/"]');
    let profile = "";
    if (linkTag) {
      const href = linkTag.getAttribute("href");
      profile = href.startsWith("http")
        ? href
        : `https://www.linkedin.com${href}`;
    }

    let avatar = "";
    const avatarImg = document.querySelector(
      ".pv-top-card-profile-picture__image, .mkbdwiuRcVliyZALZIeqEwdIrSCtmTOrPOA"
    );
    if (avatarImg && avatarImg.src) avatar = avatarImg.src;
    if (!avatar && name) {
      avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
    }

    let first_name = "",
      last_name = "";
    if (name) {
      const parts = name.split(" ");
      first_name = parts[0] || "";
      last_name = parts.slice(1).join(" ") || "";
    }

    return {
      name,
      profile,
      avatar,
      info: "",
      current_job_title: "",
      summary: "",
      first_name,
      last_name,
    };
  }

  function injectProfileImportButtonInCustomDiv() {
    const customDiv = document.querySelector(".hAQynntdEFUsKEiwJQadisSUFbmMM");
    if (!customDiv) return;

    if (customDiv.querySelector("#mp-profile-import-btn")) return;

    const wrapper = document.createElement("div");
    wrapper.style.marginTop = "0px";

    const btn = document.createElement("button");
    btn.id = "mp-profile-import-btn";
    btn.type = "button";
    btn.textContent = "Import Prospect";
    btn.style.background = "#101112";
    btn.style.color = "#fff";
    btn.style.fontWeight = "500";
    btn.style.fontSize = "14px";
    btn.style.border = "none";
    btn.style.borderRadius = "20px";
    btn.style.marginRight = "10px";
    btn.style.padding = "6px 12px 8px 12px";
    btn.style.cursor = "pointer";
    btn.style.transition = "background 0.18s";

    btn.onclick = (e) => {
      e.stopPropagation();
      const userInfo = extractProfileInfoFromCustomCard();
      if (!userInfo) return;
      showImportDrawer({
        querySelector: () => null,
        textContent: "",
        getAttribute: () => null,
        ...userInfo,
      });
    };

    wrapper.appendChild(btn);
    customDiv.appendChild(wrapper);
  }

  function waitForMoreActionsButtonAndInject(retries = 30) {
    // First try to inject the main button
    injectImportButton();

    let actionRow = document.querySelector(
      ".pv-top-card-v2-ctas, .pvs-profile-actions, .artdeco-card .pvs-profile-actions"
    );

    if (!actionRow) {
      const allRows = Array.from(document.querySelectorAll("div, section"));
      actionRow = allRows.find(
        (row) =>
          row.querySelector(
            'button[aria-label="Connect"], button[aria-label="Message"]'
          ) &&
          row.querySelector(
            'button[aria-label="More"], button[aria-label="More actions"]'
          )
      );
    }

    if (!actionRow) {
      if (retries > 0) {
        setTimeout(() => waitForMoreActionsButtonAndInject(retries - 1), 300);
      } else {
        console.warn("Import Prospect: Action row not found.");
      }
      return;
    }

    let moreActionsBtn =
      actionRow.querySelector('button[aria-label="More actions"]') ||
      actionRow.querySelector('button[aria-label="More"]') ||
      Array.from(actionRow.querySelectorAll("button[aria-label]")).find((btn) =>
        btn.getAttribute("aria-label").toLowerCase().includes("more")
      );

    if (moreActionsBtn) {
      injectProfileImportButtonInCustomDiv();
      return;
    }

    if (retries > 0) {
      setTimeout(() => waitForMoreActionsButtonAndInject(retries - 1), 300);
    } else {
      console.warn(
        "Import Prospect: More actions button not found in action row."
      );
    }
  }

  function isLinkedInProfile() {
    return (
      window.location.hostname === "www.linkedin.com" &&
      window.location.pathname.includes("/in/") &&
      window.location.pathname.match(/\/in\/[^\/]+\/?$/) // Ensures it's a profile URL format
    );
  }
  // Main execution logic
  function run() {
    // Double-check we're still on a profile page before running
    if (!isLinkedInProfile()) {
      console.log("Not on LinkedIn profile page, skipping run");
      return;
    }

    // Immediate attempt
    setTimeout(() => {
      if (isLinkedInProfile()) {
        injectImportButton();
        waitForMoreActionsButtonAndInject();
      }
    }, 100);

    // Second attempt after 500ms
    setTimeout(() => {
      if (isLinkedInProfile()) {
        injectImportButton();
        waitForMoreActionsButtonAndInject();
      }
    }, 500);

    // Third attempt after 1 second
    setTimeout(() => {
      if (isLinkedInProfile()) {
        injectImportButton();
        waitForMoreActionsButtonAndInject();
      }
    }, 1000);

    // Fourth attempt after 2 seconds
    setTimeout(() => {
      if (isLinkedInProfile()) {
        injectImportButton();
        waitForMoreActionsButtonAndInject();
      }
    }, 2000);
  }
  // Run on DOM ready and observe for navigation changes
  // Updated main execution logic with better SPA navigation handling
  function initializeScript() {
    // Function to check if current page is a LinkedIn profile
    function isLinkedInProfilePage() {
      return (
        window.location.hostname === "www.linkedin.com" &&
        window.location.pathname.includes("/in/") &&
        window.location.pathname.match(/\/in\/[^\/]+\/?$/)
      );
    }

    // Only initialize if we're on a LinkedIn profile page
    if (!isLinkedInProfilePage()) {
      console.log("Not on LinkedIn profile page, skipping initialization");
      return;
    }

    console.log("LinkedIn profile page detected, initializing script");

    // Run on DOM ready and observe for navigation changes
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }

    // Observe for navigation changes (LinkedIn SPA)
    let currentURL = window.location.href;
    const observer = new MutationObserver((mutations) => {
      // Check if URL changed
      if (window.location.href !== currentURL) {
        currentURL = window.location.href;

        // Only run if the new URL is also a LinkedIn profile page
        if (isLinkedInProfilePage()) {
          console.log("Navigated to LinkedIn profile page, running script");
          setTimeout(run, 800);
          setTimeout(run, 1500); // Additional attempt
        } else {
          console.log("Navigated away from LinkedIn profile page");
          // Optionally remove buttons if they exist
          const existingButton = document.querySelector(
            "#mp-view-prospect-btn"
          );
          if (existingButton) {
            existingButton.remove();
          }
        }
      }

      // Also check for specific DOM changes that might indicate profile loaded
      // But only if we're still on a profile page
      if (isLinkedInProfilePage()) {
        mutations.forEach((mutation) => {
          if (mutation.type === "childList") {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) {
                // Element node
                // Check if profile-specific elements were added
                if (
                  node.querySelector &&
                  (node.querySelector(".pv-top-card") ||
                    node.querySelector("#profile-sticky-header-toggle") ||
                    node.id === "profile-sticky-header-toggle")
                ) {
                  setTimeout(run, 200);
                }
              }
            });
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Additional listener for when profile content loads
    // But only observe if we're on a profile page
    if (isLinkedInProfilePage()) {
      const profileContentObserver = new MutationObserver(() => {
        if (
          isLinkedInProfilePage() &&
          !document.querySelector("#mp-view-prospect-btn")
        ) {
          setTimeout(run, 300);
        }
      });

      // Start observing when main content area exists
      const mainContent = document.querySelector("main") || document.body;
      profileContentObserver.observe(mainContent, {
        childList: true,
        subtree: true,
      });
    }
  }
  // Call the initialization
  initializeScript();

  // Observe for navigation changes (LinkedIn SPA)
})();
