   const systemPrompt = `You are an AI assistant that helps determine if a LinkedIn post is relevant to a user's business goals.
Instructions:
- Read the user’s business goal.
- Read the LinkedIn post content.
- Decide if the post is a good opportunity based on the goal.
- mark it relevant only if it is very highly relevant.
- Respond ONLY with one of the following and also explain why:
  - Relevant
  - Not Relevant`;

const linkedinPost=  `Most IT professionals overcomplicate email marketing from day one.After 15 years as a woman in IT and now building educational email courses for IT companies, I've learned that the best strategies are often the simplest ones.Here's what actually works:Simple tips I would give anyone who wants to start email marketing for the IT industry:1. Start with problems, not solutions.Don't lead with "We offer cloud migration services." Start with "Is your team still working overtime because of system crashes?" Problems grab attention. Solutions come later.2. Use their language, not yours. Replace "We optimize enterprise-grade infrastructure" with "We eliminate those 2 AM emergency calls." Speak human first, technical second.3. One clear ask per email Book a call OR download a guide OR schedule a demo. Never all three. Decision fatigue kills responses.4. Follow up (most people don't). 80% of IT sales happen after the 5th follow-up, but 90% of people stop after the first email. Be in the 10% who persist.The truth? You already know more than you think you do. You just need to translate your expertise into words that busy IT decision-makers actually care about.What's your biggest challenge with IT email marketing?`

const userPrompt = `BUSINESS GOAL:
I sell a CRM for small B2B businesses to help them manage outreach, email campaigns, and sales pipelines. Target audience: founders, marketers, and sales managers.
LINKEDIN POST:${linkedinPost}
`


async function generateLinkedInComment() {
  try {
    const response = await fetch(
      "https://app.manageplus.io/admin/api/ai/chat",
      {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
        },
        referrer: "https://www.linkedin.com/",
        body: JSON.stringify({
          model: "llama3.1:latest",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content:userPrompt ,
            },
          ],
          options: {
            max_token: 256,
            repeat_penalty: 1.2,
          },
        }),
        method: "POST",
        mode: "cors",
        credentials: "omit",
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error generating comment:", error);
    return null;
  }
}


generateLinkedInComment().then((result) => {
  console.log("Generated comment:", result);
});
