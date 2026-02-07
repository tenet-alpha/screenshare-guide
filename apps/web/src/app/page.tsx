"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ScreenShareSession } from "@/components/ScreenShareSession";

interface SessionData {
  token: string;
  sessionId: string;
  template: { id: string; name: string; steps: any[] };
}

export default function HomePage() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const createProof = trpc.session.createProof.useMutation({
    onSuccess: (data) => {
      try {
        // Guard: template must exist in response
        if (!data.template) {
          console.error("[createProof] Response missing template field:", JSON.stringify(data));
          setSetupError("Server returned incomplete data (no template). Please try again.");
          return;
        }

        // Defensive: ensure template.steps is a valid array
        const steps = Array.isArray(data.template.steps)
          ? data.template.steps
          : typeof data.template.steps === "string"
            ? JSON.parse(data.template.steps as unknown as string)
            : [];

        if (!steps.length) {
          console.error("[createProof] Empty or invalid steps:", data.template.steps);
          setSetupError("Invalid template data received. Please try again.");
          return;
        }

        setSetupError(null);
        setSession({
          token: data.token,
          sessionId: data.sessionId,
          template: {
            id: data.template.id,
            name: data.template.name,
            steps,
          },
        });
      } catch (err) {
        console.error("[createProof] Failed to parse session data:", err);
        setSetupError("Failed to initialize session. Please try again.");
      }
    },
    onError: () => {
      setSetupError(null); // Let the createProof.error handle display
    },
  });

  // Active session — render the full proof experience
  if (session?.template?.steps?.length) {
    return (
      <ScreenShareSession
        token={session.token}
        sessionId={session.sessionId}
        template={session.template}
        initialStep={0}
      />
    );
  }

  // Landing — single CTA
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-lg w-full text-center">
        {/* Icon */}
        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
          Prove Your Instagram Audience
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-10">
          Verify your Instagram reach and engagement in 3 quick steps
        </p>

        {/* Start Button */}
        <button
          onClick={() => createProof.mutate()}
          disabled={createProof.isLoading}
          className="px-10 py-5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-semibold rounded-xl text-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {createProof.isLoading ? (
            <span className="flex items-center gap-3">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Starting...
            </span>
          ) : (
            "Start Verification"
          )}
        </button>

        <p className="text-sm text-gray-400 dark:text-gray-500 mt-6">
          You'll share your screen and follow 3 guided steps to verify your metrics
        </p>

        {/* Error */}
        {(createProof.error || setupError) && (
          <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {setupError || "Failed to start session. Please try again."}
          </div>
        )}
      </div>
    </main>
  );
}
