import type { TagKind } from "./parsing";

/** Tag / category definitions aligned with conversationRatingPrompt.js vocabulary. */
const QA_TAG_DESCRIPTIONS: Record<string, string> = {
  "Incorrect Answer":
    "Factually or procedurally wrong answer while the user's question was understood.",
  "Context Handling Failure":
    "Bot loses, ignores, or contradicts information the user already stated earlier in the session.",
  "Correction Ignored":
    "User corrects or re-asks after a wrong/unhelpful reply and the bot still does not resolve it.",
  "Class Mismatch":
    "User and bot explicitly name different class/grade numbers.",
  "Level/Board Mismatch":
    "Wrong board, exam level, or out-of-school scope vs what the user asked.",
  "Chapter Mismatch":
    "User requested one chapter but the bot delivered or assumed a different chapter.",
  "Insufficient Input Data":
    "User message too vague for a reasonable answer without clarification.",
  "Image Reading Error":
    "Bot misreads or misuses visible image content on an image-upload turn.",
  "Unwanted Template Push":
    "Slotfill/template output when the user wanted a direct conversational answer.",
  "Completion Refusal":
    "Bot refuses to complete the user's request citing learn-by-yourself reasons.",
  "Gone Exception":
    "[No response text] on a qualifying turn with no image upload in the session.",
  "Image Gone Exception":
    "[No response text] on a qualifying turn when the session includes image upload.",
  "Slow Generation":
    "User complains the bot reply is too slow or delayed.",
  "Excessive Clarification":
    "Bot over-asks clarifying questions when enough context was already available.",
  "Feature Request Gap":
    "User asks for unsupported product capability—not a wrong in-scope answer.",
};

const DISCOVERY_TAG_DESCRIPTIONS: Record<string, string> = {
  "Gibberish / Unintelligible":
    "Nonsensical or corrupted text that cannot reasonably be interpreted.",
  "Non-Academic":
    "Primary intent is unrelated to school/academic learning.",
  "Academic":
    "Primary intent is school/academic learning (homework, exams, curriculum).",
  "Mock / Practice Questions":
    "User wants practice questions, mock tests, quizzes, or exam-style drills.",
  "Previous Year Questions":
    "User asks for past exam papers, PYQs, or model papers.",
  "Outside School Level Questions":
    "College, competitive exams, or topics above class 12 scope.",
  "Non-CBSE Board":
    "User explicitly names a board other than CBSE (ICSE, state board, etc.).",
  "Class 5 and Below CBSE":
    "User indicates primary-level schooling (class 5 or below).",
  "Not Math/Science":
    "In-school academic session in a subject other than math or science.",
  "Image Upload": "Session includes at least one image-upload turn.",
  "Speech to Text": "Session includes speech-to-text input.",
  "Slotfill":
    "Bot used structured slot-fill/template output (Type: … markers or slot_filling metadata).",
  "Blurry / Unclear Image":
    "Bot says the uploaded image or its text is blurry, unclear, or unreadable.",
  "Specific Named Resource":
    "User asks for a named chapter, lesson, unit, book, or textbook section.",
  "Direct Response":
    "User wants a plain conversational answer instead of slotfill/template output.",
};

/** Fixed conversation-category labels from the rating prompt (not subject/topic discovery). */
export const CATEGORY_TAG_VOCABULARY: ReadonlySet<string> = new Set(
  Object.keys(DISCOVERY_TAG_DESCRIPTIONS)
);

export function isCategoryVocabularyTag(tag: string): boolean {
  return CATEGORY_TAG_VOCABULARY.has(tag.trim());
}

export function getTagDescription(tag: string, kind: TagKind): string | null {
  const t = tag.trim();
  if (!t) return null;
  if (kind === "qa") return QA_TAG_DESCRIPTIONS[t] ?? null;
  if (kind === "discovery" || kind === "category") return DISCOVERY_TAG_DESCRIPTIONS[t] ?? null;
  return null;
}

export function getTagDescriptionOrDefault(tag: string, kind: TagKind): string {
  return (
    getTagDescription(tag, kind) ??
    (kind === "category"
      ? "Conversation category label from the rating prompt."
      : kind === "discovery"
        ? "Discovery tag from the rating prompt."
        : "QA issue tag from the rating prompt.")
  );
}
