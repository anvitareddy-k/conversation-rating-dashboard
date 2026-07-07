const TARS_SID_BASE =
  "https://tars.ck12.org/index/chatbot_conversation_rating/list-by-chatbot-sid";

export function tarsSidUrl(chatbotSid: string): string {
  return `${TARS_SID_BASE}/${encodeURIComponent(chatbotSid.trim())}`;
}
