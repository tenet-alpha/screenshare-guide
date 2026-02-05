import type { TemplateStep } from "@screenshare-guide/db";

/**
 * Test fixtures for tRPC route testing
 */

export const sampleTemplateSteps: TemplateStep[] = [
  {
    instruction: "Open the Instagram app on your device",
    successCriteria: "Instagram home feed or login screen is visible",
    hints: ["Look for the Instagram icon", "It looks like a camera"],
  },
  {
    instruction: "Navigate to your profile page",
    successCriteria: "Profile page with avatar and bio is visible",
    hints: ["Tap the profile icon in the bottom right"],
  },
  {
    instruction: "Go to Professional Dashboard",
    successCriteria: "Professional Dashboard screen is visible",
    hints: ["Look for 'Professional Dashboard' link below your bio"],
  },
];

export const sampleTemplate = {
  name: "Instagram Demographics Guide",
  description: "Guide users to view their Instagram demographics data",
  steps: sampleTemplateSteps,
};

export const sampleTemplate2 = {
  name: "Twitter Settings Guide",
  description: "Navigate to Twitter privacy settings",
  steps: [
    {
      instruction: "Open Twitter/X app",
      successCriteria: "Twitter timeline is visible",
    },
    {
      instruction: "Tap your profile picture to open the menu",
      successCriteria: "Side menu is open showing settings option",
    },
  ],
};

export function createMockTemplate(overrides: Partial<typeof sampleTemplate> = {}) {
  return {
    ...sampleTemplate,
    ...overrides,
  };
}

export function createMockSession(overrides: Record<string, any> = {}) {
  return {
    token: "abc123xyz",
    templateId: "template-uuid-1",
    status: "pending",
    currentStep: 0,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}
