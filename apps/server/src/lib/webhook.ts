import { log } from "./logger";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export interface WebhookPayload {
  event: "session.completed";
  sessionId: string;
  platform: string;
  extractedData: Array<{ label: string; value: string }>;
  completedAt: string;
}

export async function notifyWebhook(payload: WebhookPayload): Promise<void> {
  if (!WEBHOOK_URL) return;

  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Optional HMAC signature for webhook verification
    if (WEBHOOK_SECRET) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
      headers["X-Webhook-Signature"] = Buffer.from(signature).toString("hex");
    }

    const resp = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!resp.ok) {
      log.warn("Webhook delivery failed", { status: resp.status, url: WEBHOOK_URL });
    } else {
      log.info("Webhook delivered", { sessionId: payload.sessionId, status: resp.status });
    }
  } catch (error) {
    log.error("Webhook delivery error", error as Error);
  }
}
