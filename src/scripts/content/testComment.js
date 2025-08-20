// Test Comment Button & Drawer Content Script (self-contained)

const {
  APIURL,
  MaxTokens,
  defaultStartPrompt,
  defaultEndPrompt,
  topicSystemPrompt,
  topicSystemPromptDrawer,
} = require("../../utils/constant");
const { showNotification } = require("../../utils/notification");

(function () {
  // Inject custom styles for the drawer and its contents
  function injectDrawerStyles() {
    if (document.getElementById("mp-test-drawer-style")) return;
    const style = document.createElement("style");
    style.id = "mp-test-drawer-style";
    style.textContent = `
      .mp-test-drawer-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.30); z-index: 99998; transition: opacity 0.3s;
      }
      .mp-test-drawer {
        position: fixed; top: 0; right: 0; width: 400px; height: 100vh; background: #fff;
        box-shadow: rgba(0,0,0,0.1) -2px 0px 5px; z-index: 99999;
        display: flex; flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
      }
      .mp-drawer-open { transform: translateX(0); }
      .mp-drawer-closed { transform: translateX(100%); }
      .mp-test-drawer-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px 10px 18px; border-bottom: 1px solid #e5e7eb;
        position: relative;
      }
      .mp-test-drawer-logo-title { display: flex; align-items: center; gap: 6px; }
      .mp-test-drawer-logo { width: 36px; height: 36px; border-radius: 6px; }
      .mp-test-drawer-title { font-size: 2rem; font-weight: 700; color: #22223b; letter-spacing: -0.5px; }
      .mp-test-drawer-close {
        background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px;
        position: absolute; top: 12px; right: 12px; z-index: 2;
        width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
        transition: background 0.15s;
      }
      .mp-test-drawer-close:hover { background: #f3f4f6; }
      .mp-test-drawer-close svg { width: 22px; height: 22px; color: #222; }
      .mp-test-drawer-main {
        flex: 1; overflow-y: auto; padding: 18px 18px 12px 18px; display: flex; flex-direction: column; gap: 18px;
      }
      
      /* Simple Accordion Styles */
      .mp-accordion {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .mp-accordion-item {
        /* No borders or card styling */
      }
      .mp-accordion-header {
        background: none;
        border: none;
        padding: 0;
        width: 100%;
        text-align: left;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 1.1rem;
        font-weight: 600;
        color: #374151;
        transition: color 0.2s;
        margin-bottom: 12px;
      }
      .mp-accordion-header:hover {
        color: #111827;
      }
    
      .mp-accordion-icon {
        transform: rotate(0deg);
        transition: transform 0.3s;
        width: 20px;
        height: 20px;
        color: #6b7280;
      }
      .mp-accordion-header.active .mp-accordion-icon {
        transform: rotate(180deg);
        
      }
      .mp-accordion-content {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s ease-out;
        background: none;
      }
      .mp-accordion-content.active {
        max-height: 1000px;
      }
      .mp-accordion-body {
        padding: 0;
        padding-bottom: 16px;
      }
      
      .mp-test-drawer-section-title { font-size: 1.55rem; font-weight: 700; color: #22223b; margin-bottom: 4px; }
      .mp-test-drawer-desc { font-size: 1.15rem; color: #555; margin-bottom: 0; }
      .mp-test-drawer-label { font-size: 14px; font-weight: 700; color: #333; margin-bottom: 2px; }
            .mp-test-drawer-label-sub { font-size: 12px; font-weight: 400; color: #6b7280; margin-bottom: 6px;}
      .mp-test-drawer-textarea {
        width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px 14px; font-size: 1rem;
        min-height: 140px; resize: vertical; margin-bottom: 0;
        font-family: inherit; background: #fafbfc;
        transition: border-color 0.2s;
      }
      .mp-test-drawer-textarea:focus { outline: none; border-color: #101112; background: #fff; }
      .mp-test-drawer-btn-row { display: flex; gap: 12px; margin-top: 6px; }
      .mp-test-drawer-btn {
        flex: 1; font-size: 1rem; font-weight: 600; border-radius: 7px;
        padding: 10px 0; cursor: pointer; transition: background 0.2s, color 0.2s, border 0.2s, box-shadow 0.2s;
      }
      .mp-test-drawer-btn-primary {
        background: #101112; color: #fff; border: none;
      }
      .mp-test-drawer-btn-primary:hover { background: #232325; }
      .mp-test-drawer-btn-secondary {
        background: transparent; color: #22223b; border: 1px solid #dfdfdf; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }
      .mp-test-drawer-btn-secondary:hover {
        background: #f6f6f7; border-color: #bdbdbd;
      }
      .mp-test-drawer-btn-single {
        width: 100%; font-size: 1rem; font-weight: 600; border-radius: 7px;
        padding: 10px 0; cursor: pointer; transition: background 0.2s, color 0.2s, border 0.2s;
        background: #101112; color: #fff; border: none; margin-top: 6px;
      }
      .mp-test-drawer-btn-single:hover { background: #101112; }
      .mp-test-drawer-output-section { margin-top: 18px; }
      .mp-test-drawer-output-label { font-size: 1.15rem; font-weight: 500; color: #333; margin-bottom: 6px; }
      .mp-test-drawer-output {
        width: 100%; min-height: 48px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;
        padding: 10px 12px; font-size: 1rem; color: #22223b; word-break: break-word;
      }
      .mp-test-drawer-use-btn {
        margin-top: 12px; background: #22c55e; color: #fff; font-weight: 600; border: none; border-radius: 7px;
        padding: 10px 0; width: 100%; font-size: 1rem; cursor: pointer; box-shadow: 0 1px 2px rgba(34,197,94,0.08);
        transition: background 0.2s;
      }
      .mp-test-drawer-use-btn:hover { background: #16a34a; }
      .mp-test-drawer-use-btn.hidden { display: none; }
      .mp-test-drawer-success-msg {
        margin-top: 8px; color: #22c55e; font-size: 0.98rem; font-weight: 500; display: none;
        text-align: center;
      }
      .mp-test-drawer-success-msg.active { display: block; }
      .mp-test-spinner {
        display: inline-block;
        vertical-align: middle;
        width: 18px; height: 18px;
        border: 2.5px solid #fff;
        border-right-color: transparent;
        border-radius: 50%;
        animation: mp-spin 0.7s linear infinite;
      }
      @keyframes mp-spin {
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  // Utility: Create and show drawer
  function showTestCommentDrawer(
    post,
    postContent,
    onGenerate,
    onCheckRelevance
  ) {
    injectDrawerStyles();
    // Remove any existing drawer
    const existing = document.getElementById("mp-test-comment-drawer");
    if (existing) existing.remove();
    const overlay = document.getElementById("mp-test-comment-overlay");
    if (overlay) overlay.remove();

    // Find main LinkedIn feed container
    let parent = document.querySelector("div.feed-outlet, main, #main, body");
    if (!parent) parent = document.body;

    // Overlay
    const overlayDiv = document.createElement("div");
    overlayDiv.id = "mp-test-comment-overlay";
    overlayDiv.className = "mp-test-drawer-overlay";
    overlayDiv.onclick = closeDrawer;
    parent.appendChild(overlayDiv);

    // Drawer
    const drawer = document.createElement("div");
    drawer.id = "mp-test-comment-drawer";
    drawer.className = "mp-test-drawer mp-drawer-closed";

    // Header
    const header = document.createElement("div");
    header.className = "mp-test-drawer-header";
    // Logo and title
    const logoTitle = document.createElement("div");
    logoTitle.className = "mp-test-drawer-logo-title";
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL("assets/logo_48.png");
    logo.alt = "ManagePlus Logo";
    logo.className = "mp-test-drawer-logo";
    const title = document.createElement("span");
    title.textContent = "ManagePlus";
    title.className = "mp-test-drawer-title";
    logoTitle.appendChild(logo);
    logoTitle.appendChild(title);
    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L14 14M14 6L6 14" stroke="#222" stroke-width="2" stroke-linecap="round"/></svg>`;
    closeBtn.className = "mp-test-drawer-close";
    closeBtn.onclick = closeDrawer;
    header.appendChild(logoTitle);
    header.appendChild(closeBtn);
    drawer.appendChild(header);

    // Main content
    const main = document.createElement("div");
    main.className = "mp-test-drawer-main";

    // Create Simple Accordion
    const accordion = document.createElement("div");
    accordion.className = "mp-accordion";

    // Accordion Item 1: Generate Comment
    const accordionItem1 = createAccordionItem(
      "generate-comment",
      "Generate Comment through AI",
      "Use AI to generate a professional, relevant comment for this LinkedIn post.",
      true // default open
    );

    // Add content to first accordion
    const commentContent = accordionItem1.querySelector(".mp-accordion-body");

    // Prompt section for comment generation
    const promptSection1 = document.createElement("div");
    const promptLabel1 = document.createElement("label");
    promptLabel1.textContent = "Prompt";
    promptLabel1.className = "mp-test-drawer-label";
    const promptInput1 = document.createElement("textarea");
    promptInput1.className = "mp-test-drawer-textarea";
    promptInput1.placeholder = "Type your prompt for the comment...";
    promptInput1.id = "comment-prompt";

    // Prefill from localStorage
    chrome.storage.local.get(["userPrompt"], ({ userPrompt }) => {
      if (userPrompt) promptInput1.value = userPrompt;
    });

    promptSection1.appendChild(promptLabel1);
    promptSection1.appendChild(promptInput1);
    commentContent.appendChild(promptSection1);

    // Buttons for comment generation
    const btnRow1 = document.createElement("div");
    btnRow1.className = "mp-test-drawer-btn-row";
    const generateBtn = document.createElement("button");
    generateBtn.textContent = "Generate Comment";
    generateBtn.className = "mp-test-drawer-btn mp-test-drawer-btn-primary";
    generateBtn.type = "button";
    generateBtn.id = "generate-comment-btn";
    const savePromptBtn = document.createElement("button");
    savePromptBtn.textContent = "Save Prompt";
    savePromptBtn.className = "mp-test-drawer-btn mp-test-drawer-btn-secondary";
    savePromptBtn.type = "button";
    btnRow1.appendChild(generateBtn);
    btnRow1.appendChild(savePromptBtn);
    commentContent.appendChild(btnRow1);

    // Output section for comment
    const outputSection1 = createOutputSection("Generated Comment", "comment");
    commentContent.appendChild(outputSection1);

    // Accordion Item 2: Check Post Relevance
    const accordionItem2 = createAccordionItem(
      "check-relevance",
      "Check Post Relevance to Your Goal",
      "Analyze how relevant this post is to your business goal.",
      false // default closed
    );

    // Add content to second accordion
    const relevanceContent = accordionItem2.querySelector(".mp-accordion-body");

    // Prompt section for relevance check
    const promptSection2 = document.createElement("div");
    const promptLabel2 = document.createElement("label");
    promptLabel2.textContent = "Business Goal";
    promptLabel2.className = "mp-test-drawer-label";
    const promptLabel3 = document.createElement("label");
    promptLabel3.textContent =
      "Define your goal to determine which posts to engage with based on your target audience and business objectives";
    promptLabel3.className = "mp-test-drawer-label-sub";
    const promptInput2 = document.createElement("textarea");
    promptInput2.className = "mp-test-drawer-textarea";
    promptInput2.placeholder = "Describe your business goal...";
    promptInput2.id = "relevance-prompt";

    promptSection2.appendChild(promptLabel2);
    promptSection2.appendChild(promptLabel3);
    promptSection2.appendChild(promptInput2);
    relevanceContent.appendChild(promptSection2);

    // Button for relevance check
    const checkRelevanceBtn = document.createElement("button");
    checkRelevanceBtn.textContent = "Check Relevance";
    checkRelevanceBtn.className = "mp-test-drawer-btn-single";
    checkRelevanceBtn.type = "button";
    checkRelevanceBtn.id = "check-relevance-btn";
    relevanceContent.appendChild(checkRelevanceBtn);

    // Output section for relevance
    const outputSection2 = createOutputSection(
      "Relevance Analysis",
      "relevance"
    );
    relevanceContent.appendChild(outputSection2);

    // Add accordion items to accordion
    accordion.appendChild(accordionItem1);
    accordion.appendChild(accordionItem2);
    main.appendChild(accordion);

    // Add event listeners
    setupAccordionEventListeners(accordion);
    setupButtonEventListeners({
      generateBtn,
      savePromptBtn,
      checkRelevanceBtn,
      promptInput1,
      promptInput2,
      outputSection1,
      outputSection2,
      post,
      postContent,
      onGenerate,
      onCheckRelevance,
    });

    // Drawer structure
    drawer.appendChild(main);
    parent.appendChild(drawer);

    // Animate in
    setTimeout(() => {
      drawer.classList.remove("mp-drawer-closed");
      drawer.classList.add("mp-drawer-open");
      overlayDiv.classList.remove("opacity-0");
    }, 10);

    // Close logic
    function closeDrawer() {
      drawer.classList.remove("mp-drawer-open");
      drawer.classList.add("mp-drawer-closed");
      overlayDiv.classList.add("opacity-0");
      setTimeout(() => {
        if (drawer.parentNode) drawer.remove();
        if (overlayDiv.parentNode) overlayDiv.remove();
      }, 300);
    }
  }

  // Helper function to create simple accordion items
  function createAccordionItem(id, title, description, isOpen = false) {
    const item = document.createElement("div");
    item.className = "mp-accordion-item";

    const header = document.createElement("button");
    header.className = `mp-accordion-header ${isOpen ? "active" : ""}`;
    header.innerHTML = `
      <div>
        <div style="font-size: 1.25rem; font-weight: 600; margin-bottom: 4px;">${title}</div>
        <div style="font-size: 0.95rem; font-weight: 400; color: #6b7280;">${description}</div>
      </div>
      <svg class="mp-accordion-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6,9 12,15 18,9"></polyline>
      </svg>
    `;

    const content = document.createElement("div");
    content.className = `mp-accordion-content ${isOpen ? "active" : ""}`;

    const body = document.createElement("div");
    body.className = "mp-accordion-body";

    content.appendChild(body);
    item.appendChild(header);
    item.appendChild(content);

    return item;
  }

  // Helper function to create output sections
  function createOutputSection(labelText, type) {
    const outputSection = document.createElement("div");
    outputSection.className = "mp-test-drawer-output-section";
    outputSection.style.display = "none";
    outputSection.id = `output-section-${type}`;

    const outputLabel = document.createElement("div");
    outputLabel.textContent = labelText;
    outputLabel.className = "mp-test-drawer-output-label";

    const output = document.createElement("div");
    output.className = "mp-test-drawer-output";
    output.id = `output-${type}`;

    outputSection.appendChild(outputLabel);
    outputSection.appendChild(output);

    if (type === "comment") {
      // Add use button and success message for comment
      const useBtn = document.createElement("button");
      useBtn.textContent = "Use This Comment";
      useBtn.className = "mp-test-drawer-use-btn hidden";
      useBtn.id = "use-comment-btn";

      const successMsg = document.createElement("div");
      successMsg.className = "mp-test-drawer-success-msg";
      successMsg.textContent = "Copied to clipboard!";
      successMsg.id = "success-msg";

      outputSection.appendChild(useBtn);
      outputSection.appendChild(successMsg);
    }

    return outputSection;
  }

  // Setup accordion event listeners
  function setupAccordionEventListeners(accordion) {
    const headers = accordion.querySelectorAll(".mp-accordion-header");
    headers.forEach((header) => {
      header.addEventListener("click", () => {
        const content = header.nextElementSibling;
        const isActive = header.classList.contains("active");

        // Close all accordion items
        headers.forEach((h) => {
          h.classList.remove("active");
          h.nextElementSibling.classList.remove("active");
        });

        // Open clicked item if it wasn't active
        if (!isActive) {
          header.classList.add("active");
          content.classList.add("active");
        }
      });
    });
  }

  // Setup button event listeners - FIXED VERSION
  function setupButtonEventListeners({
    generateBtn,
    savePromptBtn,
    checkRelevanceBtn,
    promptInput1,
    promptInput2,
    outputSection1,
    outputSection2,
    post,
    postContent,
    onGenerate,
    onCheckRelevance,
  }) {
    let isLoading = false;

    function updateButtonStates() {
      generateBtn.disabled = isLoading;
      savePromptBtn.disabled = isLoading;
      checkRelevanceBtn.disabled = isLoading;
    }

    // Generate Comment Button
    generateBtn.onclick = async () => {
      if (isLoading) return;
      isLoading = true;
      updateButtonStates();

      const output = outputSection1.querySelector("#output-comment");
      const useBtn = outputSection1.querySelector("#use-comment-btn");
      const successMsg = outputSection1.querySelector("#success-msg");

      output.style.display = "block";
      output.textContent = "Generating...";
      useBtn.classList.add("hidden");
      successMsg.classList.remove("active");
      outputSection1.style.display = "block";

      const originalText = generateBtn.textContent;
      generateBtn.innerHTML = `<span class='mp-test-spinner'></span>Generating...`;

      try {
        const userPrompt = promptInput1.value.trim() || "";
        let comment = await onGenerate(userPrompt);
        const isInvalid =
          !comment ||
          comment === "NULL" ||
          comment.includes("I can't generate a comment");

        if (typeof comment === "string") {
          comment = comment.trim();
          if (comment.startsWith('"') && comment.endsWith('"')) {
            comment = comment.slice(1, -1).trim();
          }
        }

        output.textContent = comment || "No comment generated.";
        if (!isInvalid) {
          useBtn.classList.remove("hidden");
        }
      } catch (e) {
        output.textContent = "Error generating comment.";
      } finally {
        isLoading = false;
        generateBtn.textContent = originalText;
        updateButtonStates();
      }
    };

    // Save Prompt Button
    savePromptBtn.onclick = () => {
      const userPrompt = promptInput1.value.trim() || "";
      chrome.storage.local.set({ userPrompt }, () => {
        savePromptBtn.textContent = "Saved!";
        showNotification("Prompt saved successfully", "success");
        setTimeout(() => {
          savePromptBtn.textContent = "Save Prompt";
        }, 1200);
      });
    };

    // Use Comment Button - Get reference from the outputSection1
    const useCommentBtn = outputSection1.querySelector("#use-comment-btn");
    if (useCommentBtn) {
      useCommentBtn.onclick = () => {
        const comment =
          outputSection1.querySelector("#output-comment").textContent;
        const successMsg = outputSection1.querySelector("#success-msg");

        if (comment && comment.length > 0 && post) {
          let input =
            post.querySelector('div[contenteditable="true"][role="textbox"]') ||
            post.querySelector(".comments-comment-box__form-contenteditable") ||
            post.querySelector(".ql-editor");

          if (input) {
            input.focus();
            input.innerHTML = "";
            document.execCommand("insertText", false, comment);

            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            input.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            navigator.clipboard.writeText(comment);
            successMsg.classList.add("active");
            setTimeout(() => {
              successMsg.classList.remove("active");
            }, 1500);
          }
        }
      };
    }

    // Check Relevance Button
    checkRelevanceBtn.onclick = async () => {
      const goalPrompt = promptInput2.value.trim() || "";

      if (!goalPrompt) {
        showNotification(
          "Please enter a business goal to check relevance.",
          "error"
        );
        return;
      }

      if (isLoading) return;
      isLoading = true;
      updateButtonStates();

      const output = outputSection2.querySelector("#output-relevance");
      output.style.display = "block";
      output.textContent = "Checking relevance...";
      outputSection2.style.display = "block";

      const originalText = checkRelevanceBtn.textContent;
      checkRelevanceBtn.innerHTML = `<span class='mp-test-spinner'></span>Checking...`;

      try {
        const relevanceResult = await onCheckRelevance(goalPrompt);
        output.textContent = relevanceResult || "No analysis generated.";
      } catch (e) {
        output.textContent = "Error checking relevance.";
      } finally {
        isLoading = false;
        checkRelevanceBtn.textContent = originalText;
        updateButtonStates();
      }
    };
  }

  // Utility: Inject Test Comment button into the post's action bar
  function injectTestCommentButton(post, postContent) {
    // Prevent duplicate buttons in the comment box
    const commentForm = post.querySelector("form.comments-comment-box__form");
    if (!commentForm || commentForm.querySelector(".mp-test-comment-btn"))
      return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mp-test-comment-btn flex items-center justify-center";
    btn.style.cssText = `
      background: rgb(16, 17, 18); color: rgb(255, 255, 255); font-weight: 400; font-size: 10px;
      border: none; border-radius: 7px; padding: 0px 6px 4px 2px; margin: 5px 8px 0 6px;
      height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer;
      transition: background 0.18s;
    `;
    btn.title = "AI Comment";
    btn.onmouseenter = () => (btn.style.background = "rgb(35, 35, 37)");
    btn.onmouseleave = () => (btn.style.background = "rgb(16, 17, 18)");
    btn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:7px;">
        <circle cx="12" cy="12" r="10" fill="white" fill-opacity="0.18"/>
        <path d="M9.5 10.5C9.5 9.11929 10.6193 8 12 8C13.3807 8 14.5 9.11929 14.5 10.5C14.5 11.8807 13.3807 13 12 13C10.6193 13 9.5 11.8807 9.5 10.5Z" fill="white"/>
        <rect x="11" y="14" width="2" height="4" rx="1" fill="white"/>
      </svg>
      <span style="font-weight:500;font-size:12px;color:#fff;">AI Comment</span>
    `;

    btn.onclick = (e) => {
      e.stopPropagation();
      showTestCommentDrawer(
        post,
        postContent,
        async (userPrompt) => await generateGPTComment(postContent, userPrompt),
        async (goalPrompt) => await checkPostRelevance(postContent, goalPrompt)
      );
    };

    // Find the action row and append button
    const justifyRow = commentForm.querySelector(
      ".display-flex.justify-space-between"
    );
    if (justifyRow && justifyRow.children.length > 0) {
      const iconRow = justifyRow.querySelector(".display-flex");
      if (iconRow && !iconRow.querySelector(".mp-test-comment-btn")) {
        iconRow.appendChild(btn);
        return;
      }
    }
    commentForm.appendChild(btn);
  }

  // Extract post content utility
  function extractPostContent(post) {
    const contentElement =
      post.querySelector(".update-components-update-v2__commentary") ||
      post.querySelector(".update-components-text");
    return contentElement
      ? contentElement.textContent.trim()
      : post.textContent.trim();
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

  // Generate comment API call
  async function generateGPTComment(postContent, fallbackUserPrompt) {
    const storage = await new Promise((resolve) => {
      chrome.storage.local.get(
        ["userPrompt", "commentLength", "systemPrompt"],
        resolve
      );
    });

    const userPrompt = (fallbackUserPrompt && fallbackUserPrompt.trim()) || "";
    const systemPrompts = storage.systemPrompt || defaultStartPrompt;
    const commentLength = storage.commentLength || 30;
    const model = "llama3.1:latest";
    const finalSystemPrompt = [systemPrompts.trim(), userPrompt].join("\n");
    const systemPrompt = finalSystemPrompt.replace(
      "{{MAX_WORDS}}",
      commentLength
    );

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Instructions:${userPrompt}\nGenerate comment for post: "${postContent}"`,
        },
      ],
      options: {
        max_token: MaxTokens[commentLength] || 256,
        repeat_penalty: 1.2,
      },
    });

    try {
      const res = await fetch(`${APIURL}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await res.json();
      if (data.error) return "Error: " + (data.error.message || "API error");
      return data.data.data;
    } catch (e) {
      return "Error generating comment.";
    }
  }

  // Check post relevance API call
  async function checkPostRelevance(postContent, goalPrompt) {
    const model = "llama3.1:latest";
    const userPrompt = `BUSINESS GOAL: ${goalPrompt}\nLINKEDIN POST: ${postContent}`;

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: topicSystemPromptDrawer },
        { role: "user", content: userPrompt },
      ],
      options: {
        max_token: 512,
        repeat_penalty: 1.2,
      },
    });
    const serverUrl = `${APIURL}/ai/chat`;
    try {
      const data = await callApi({
        action: "API_POST_GENERATE_MESSAGE",
        url: serverUrl,
        method: "POST",
        body,
      });

      if (data.error) return "Error: " + (data.error.message || "API error");
      return data.data.data;
    } catch (e) {
      console.error("Error checking relevance:", e);
      return "Error checking relevance.";
    }
  }

  // Main logic: only run if showtest is true
  chrome.storage.local.get(["showtest"], ({ showtest }) => {
    if (!showtest) return;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  });

  function run() {
    const postSelector = ".feed-shared-update-v2";
    const posts = document.querySelectorAll(postSelector);
    posts.forEach((post) => {
      const postContent = extractPostContent(post);
      injectTestCommentButton(post, postContent);
    });

    // Observe for new posts
    const feed = document.querySelector("div.feed-outlet, main, body");
    if (feed && window.MutationObserver) {
      const observer = new MutationObserver(() => {
        const posts = document.querySelectorAll(postSelector);
        posts.forEach((post) => {
          if (!post.querySelector(".mp-test-comment-btn")) {
            const postContent = extractPostContent(post);
            injectTestCommentButton(post, postContent);
          }
        });
      });
      observer.observe(feed, { childList: true, subtree: true });
    }
  }
})();
