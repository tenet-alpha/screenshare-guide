/**
 * Step configuration for the screenshare-guide protocol.
 *
 * Includes link URLs, extraction schemas, link-gate steps,
 * and the hardcoded Instagram proof template.
 */

import type { ExtractionField } from "./messages";

/**
 * Step link URLs for the Instagram proof flow (2-step).
 * Maps step index → URL + button label.
 */
export const STEP_LINKS: Record<number, { url: string; label: string }> = {
  0: { url: "https://business.facebook.com/latest/home", label: "Open Meta Business Suite →" },
  1: { url: "https://business.facebook.com/latest/insights/", label: "Open Account Insights →" },
};

/**
 * Steps that require a link click before analysis begins.
 * Both steps have link buttons — analysis is gated until clicked.
 */
export const STEPS_REQUIRING_LINK_CLICK: Set<number> = new Set([0, 1]);

/**
 * Extraction schemas per step index.
 * Step 0: Open MBS + extract Handle
 * Step 1: Open Insights + extract Reach, Non-followers, Followers
 */
export const STEP_EXTRACTION_SCHEMAS: Record<number, ExtractionField[]> = {
  0: [
    { field: "Handle", description: "The Instagram handle/username (e.g. @username)", required: true },
  ],
  1: [
    { field: "Reach", description: "Total reach number", required: true },
    { field: "Non-followers reached", description: "Number of non-followers reached", required: true },
    { field: "Followers reached", description: "Number of followers reached", required: true },
  ],
};

/**
 * Hardcoded Instagram Audience Proof template definition.
 * Used by the tRPC createProof endpoint to find-or-create the template.
 */
export const INSTAGRAM_PROOF_TEMPLATE = {
  name: "Instagram Audience Proof",
  description: "Verify Instagram audience metrics via live screen analysis",
  steps: [
    {
      instruction: "Open Meta Business Suite and verify your Instagram handle",
      successCriteria:
        "The Meta Business Suite home page is visible with the left sidebar showing menu items like Home, Notifications, Inbox, Planner, Content, Insights, Ads. The Instagram handle/username must be visible and extracted.",
      hints: [],
    },
    {
      instruction: "Open Account Insights and capture your audience metrics",
      successCriteria:
        "The Insights overview page is open showing a summary section with actual numeric values for Reach, including a breakdown of Non-followers reached and Followers reached. This is NOT the sidebar menu — it must be the actual Insights dashboard with charts, numbers, and date ranges visible.",
      hints: [],
    },
  ],
};
