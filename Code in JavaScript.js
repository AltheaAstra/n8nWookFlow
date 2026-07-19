const event = $json.body.events[0];
const text = event.message.text || "";

const shouldReply =
  text.includes("@Althea") ||
  text.startsWith("/althea") ||
  text.toLowerCase().includes("althea");

const cleanText = text.replace("@Althea", "").trim();

return [
  {
    json: {
      shouldReply,
      cleanText,
      replyToken: event.replyToken
    }
  }
];