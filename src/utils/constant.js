const ONE_SECOND = 1000; //ms
const ONE_MINUTE = 60 * ONE_SECOND;

// Default settings
const DEFAULT_SETTINGS = {
  active: true,
  useGPT: true,
  apiKey: "",
  commentLength: "15",
  autoPostEnabled: true,
  dailyLimit: 20,
  minDelay: 8 * ONE_MINUTE,
  maxDelay: 15 * ONE_MINUTE,
  likePostEnabled: true,
  userPrompt: `Match the tone without deviation;
  be supportive, non-aggressive, and use direct address ('you'/'your');
  keep the comment WITHIN {{MAX_WORDS}} words;
  be engaging;
  add some value to the post through the comment;
  ask questions about the post only if needed;
  Successful comment example Output: Good to hear you’ve learned the MERN stack!`,
  isFeedCommenterActive: true,
  isTopicCommenterActive: false,
};

const defaultStartPrompt = `You are a professional comment generator. You will generate a concise, professional, and personalized comment based on the user's post. 
Follow these rules:
reference specific details from the post;
if unable to generate comment, return NULL. 
Output only the comment text or NULL.
If the post contains profanity, hate speech, slurs, or violates content policies, return NULL;
Output should not contain any explanations, markdown, or extra text.  
Failed comment example output: NULL`;

const defaultEndPrompt = ``;
const topicSystemPrompt = `You are an AI assistant that helps determine if a LinkedIn post is relevant to a user's business goals.
Instructions:
- Read the user's business goal.
- Read the LinkedIn post content.
- Decide if the post is a good opportunity based on the goal.
- mark it relevant only if it is very highly relevant.
- Respond ONLY with one of the following:
  - Relevant
  - Not Relevant`;

const connectionRequestSystemPrompt = `You are a LinkedIn connection message generator. Create concise, human-like professional connection requests.

Rules:
1. Keep messages 5-10 words maximum
2. Sound natural and conversational
3. Be professional but approachable
4. Reference profile info when available
5. Avoid overly formal language
6. No questions or explanations
7. Output ONLY the message text
8. Return NULL if insufficient data

Tone Guidelines:
- Warm but professional
- Human, not robotic
- Genuine interest
- Brief and impactful

Examples:
- "Hi John, fellow engineer, let's connect!"
- "Hello Sarah, love your marketing insights."
- "Hi Mike, impressed by your data work."
- "Hello Lisa, expanding my professional network."`;

const connectionReqSystemImpportPrompt = `You are a professional LinkedIn connection request message generator. Generate personalized, professional connection request messages based on the person's profile data.

Rules:
1. Use professional tone
2. Output ONLY the message text, no quotes or explanations
3. If unable to generate a proper message, return NULL


Guidelines for different scenarios:
- If job title is available: Reference their professional role
- If only about section is available: Reference their background/interests
- If only name is available: Create a general professional connection message
- If no meaningful data: Return NULL`;

const connectionReqUserImpportPrompt = `
Keep message between 5-10 words
Be professional and friendly
Reference their job title or background if available
Make it personalized but not overly familiar
Don't ask questions

Examples:
- "Hi John, fellow engineer, let's connect!"
- "Hello Sarah, love your marketing insights."
- "Hi Mike, impressed by your data work."
- "Hello Lisa, expanding my professional network."
`;

const anlyzerSystemPrompt = `You are a professional LinkedIn profile analyzer. Analyze if a person's profile matches specific criteria provided by the user.

Rules:
1. Analyze the profile data objectively
2. Provide a clear match percentage (0-100%)
3. Give specific reasons for the match or mismatch
4. Be professional and factual
5. Output format: "Match: X% - [reasoning]"
6. If insufficient data, mention what's missing`;

const topicSystemPromptDrawer = `You are an AI assistant that helps determine if a LinkedIn post is relevant to a user's business goals.
Instructions:
- Read the user's business goal.
- Read the LinkedIn post content.
- Decide if the post is a good opportunity based on the goal.
- mark it relevant only if it is very highly relevant.
- Respond ONLY with one of the following: with reason
  - Relevant
  - Not Relevant`;

const CommentLengthToWordsLength = {
  short: "30",
  medium: "30 - 60",
  long: "60 - 120",
};
const MaxTokens = {
  short: 75,
  medium: 150,
  long: 250,
};

const APIURL = `https://dev.manageplus.io/admin/api`;
const WEBURL = `https://dev.manageplus.io`;

module.exports = {
  DEFAULT_SETTINGS,
  ONE_SECOND,
  ONE_MINUTE,
  CommentLengthToWordsLength,
  connectionReqSystemImpportPrompt,
  connectionReqUserImpportPrompt,
  topicSystemPrompt,
  anlyzerSystemPrompt,
  defaultStartPrompt,
  defaultEndPrompt,
  topicSystemPromptDrawer,
  connectionRequestSystemPrompt,
  MaxTokens,
  APIURL,
  WEBURL,
};
