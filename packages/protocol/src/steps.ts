/**
 * Step configuration for the screenshare-guide protocol.
 *
 * Template-driven: each step carries its own link, extraction schema,
 * link-gate flag, and hints. No more separate flat maps.
 */

import type { ExtractionField } from "./messages";

/**
 * An interaction challenge used for anti-forgery verification.
 * The server picks one at random after a step's success criteria is met,
 * asks the user to perform it, and verifies via frame analysis.
 */
export interface InteractionChallenge {
  /** What to tell the user to do */
  instruction: string;
  /** What the AI should look for after the user acts */
  successCriteria: string;
  /** How long to wait for the challenge (default: CHALLENGE_TIMEOUT_MS) */
  timeoutMs?: number;
}

/**
 * A single step in a proof template.
 * Each step optionally has a navigation link, extraction schema, and link-gate.
 */
export interface ProofStep {
  instruction: string;
  successCriteria: string;
  /** Short title for the landing page step card (e.g. "Open Meta Business Suite") */
  title?: string;
  /** Short user-facing description for the landing page step card */
  description?: string;
  link?: { url: string; label: string };
  extractionSchema?: ExtractionField[];
  requiresLinkClick?: boolean;
  hints?: string[];
  /** Expected domain for URL verification (anti-forgery) */
  expectedDomain?: string;
  /** Interaction challenges for anti-forgery verification */
  interactionChallenges?: InteractionChallenge[];
}

/**
 * A complete proof template for a platform.
 */
export interface ProofTemplate {
  name: string;
  platform: string;
  description: string;
  /** Subtitle shown on the completion screen (e.g. "Your Instagram audience data has been verified.") */
  completionMessage?: string;
  steps: ProofStep[];
}

/**
 * Instagram Audience Proof template definition.
 * Used by the tRPC createProof endpoint to find-or-create the template.
 */
export const INSTAGRAM_PROOF_TEMPLATE: ProofTemplate = {
  name: "Instagram Audience Proof",
  platform: "instagram",
  description: "Quick, secure verification of your Instagram reach and audience metrics.",
  completionMessage: "Your Instagram audience data has been verified.",
  steps: [
    {
      instruction: "Open Meta Business Suite and verify your Instagram handle",
      title: "Open Meta Business Suite",
      description: "We'll verify your Instagram handle from your business dashboard.",
      successCriteria:
        "The Meta Business Suite home page is visible with the left sidebar showing menu items like Home, Notifications, Inbox, Planner, Content, Insights, Ads. The Instagram handle/username must be visible and extracted.",
      link: { url: "https://business.facebook.com/latest/home", label: "Open Meta Business Suite →" },
      requiresLinkClick: true,
      extractionSchema: [
        { field: "Handle", description: "The Instagram handle/username (e.g. @username)", required: true },
      ],
      expectedDomain: "business.facebook.com",
      interactionChallenges: [
        { instruction: "Click on 'Notifications' in the left sidebar", successCriteria: "The Notifications panel or page is now visible" },
        { instruction: "Click on 'Home' in the left sidebar to return to the main dashboard", successCriteria: "The Meta Business Suite home/dashboard page is visible again" },
      ],
      hints: [],
    },
    {
      instruction: "Open Account Insights and capture your audience metrics",
      title: "View Your Insights",
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
      expectedDomain: "business.facebook.com",
      interactionChallenges: [
        { instruction: "Click the date range selector and change the time period", successCriteria: "The date range picker is open or the metrics have changed to reflect a different date range" },
        { instruction: "Scroll down to show more metrics on the page", successCriteria: "The page has scrolled down showing additional metrics or charts below the initial view" },
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
