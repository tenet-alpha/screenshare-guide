/**
 * Step configuration for the screenshare-guide protocol.
 *
 * Template-driven: each step carries its own link, extraction schema,
 * link-gate flag, and hints. No more separate flat maps.
 */

import type { ExtractionField } from "./messages";

/**
 * A single step in a proof template.
 * Each step optionally has a navigation link, extraction schema, and link-gate.
 */
export interface ProofStep {
  instruction: string;
  successCriteria: string;
  /** Short user-facing description for the landing page step card */
  description?: string;
  link?: { url: string; label: string };
  extractionSchema?: ExtractionField[];
  requiresLinkClick?: boolean;
  hints?: string[];
}

/**
 * A complete proof template for a platform.
 */
export interface ProofTemplate {
  name: string;
  platform: string;
  description: string;
  steps: ProofStep[];
}

/**
 * Instagram Audience Proof template definition.
 * Used by the tRPC createProof endpoint to find-or-create the template.
 */
export const INSTAGRAM_PROOF_TEMPLATE: ProofTemplate = {
  name: "Instagram Audience Proof",
  platform: "instagram",
  description: "Verify Instagram audience metrics via live screen analysis",
  steps: [
    {
      instruction: "Open Meta Business Suite and verify your Instagram handle",
      description: "We'll verify your Instagram handle from your business dashboard.",
      successCriteria:
        "The Meta Business Suite home page is visible with the left sidebar showing menu items like Home, Notifications, Inbox, Planner, Content, Insights, Ads. The Instagram handle/username must be visible and extracted.",
      link: { url: "https://business.facebook.com/latest/home", label: "Open Meta Business Suite →" },
      requiresLinkClick: true,
      extractionSchema: [
        { field: "Handle", description: "The Instagram handle/username (e.g. @username)", required: true },
      ],
      hints: [],
    },
    {
      instruction: "Open Account Insights and capture your audience metrics",
      description: "We'll capture your reach, followers reached, and non-followers reached.",
      successCriteria:
        "The Insights overview page is open showing a summary section with actual numeric values for Reach, including a breakdown of Non-followers reached and Followers reached. This is NOT the sidebar menu — it must be the actual Insights dashboard with charts, numbers, and date ranges visible.",
      link: { url: "https://business.facebook.com/latest/insights/", label: "Open Account Insights →" },
      requiresLinkClick: true,
      extractionSchema: [
        { field: "Reach", description: "Total reach number", required: true },
        { field: "Non-followers reached", description: "Number of non-followers reached", required: true },
        { field: "Followers reached", description: "Number of followers reached", required: true },
      ],
      hints: [],
    },
  ],
};

/**
 * Registry of proof templates by platform.
 * Adding a new platform is just defining a new ProofTemplate and registering it here.
 */
export const PROOF_TEMPLATES: Record<string, ProofTemplate> = {
  instagram: INSTAGRAM_PROOF_TEMPLATE,
};

/**
 * Get all known extraction field names across all steps of a template.
 * Useful for filtering extracted data to only include valid fields.
 */
export function getAllExtractionFields(template: ProofTemplate): Set<string> {
  return new Set(
    template.steps
      .flatMap((s) => s.extractionSchema || [])
      .map((f) => f.field)
  );
}
