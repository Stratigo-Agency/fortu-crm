import { after } from "next/server";
import { handleVerify, handleWebhookPost } from "@/lib/whatsapp/webhook";

// WhatsApp Business Platform webhook (Cloud API / Coexistence). Logic in lib/whatsapp/webhook.ts.

/** Meta's subscription check: answers hub.challenge when hub.verify_token matches META_VERIFY_TOKEN. */
export function GET(request: Request) {
  return handleVerify(request);
}

/** A signed event: stored, answered with 200, processed right after the response. */
export function POST(request: Request) {
  return handleWebhookPost(request, { schedule: (task) => after(task) });
}
