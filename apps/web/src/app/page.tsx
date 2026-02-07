"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function HomePage() {
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createProof = trpc.session.createProof.useMutation({
    onSuccess: (data) => {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      setGeneratedUrl(`${baseUrl}${data.shareUrl}`);
      setCopied(false);
    },
  });

  const handleCopy = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = generatedUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
          Generate a verification link to prove your Instagram reach and engagement
        </p>

        {/* Generate Button */}
        {!generatedUrl && (
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
                Generating...
              </span>
            ) : (
              "Generate Proof Link"
            )}
          </button>
        )}

        {/* Generated Link */}
        {generatedUrl && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 font-medium">
              Your verification link is ready:
            </p>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
              <code className="flex-1 text-sm text-gray-800 dark:text-gray-200 break-all text-left">
                {generatedUrl}
              </code>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCopy}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-medium rounded-lg transition-all"
              >
                {copied ? "✓ Copied!" : "Copy Link"}
              </button>
              <button
                onClick={() => {
                  setGeneratedUrl(null);
                  createProof.reset();
                }}
                className="px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-all"
              >
                New Link
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {createProof.error && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {createProof.error.message}
          </div>
        )}
      </div>
    </main>
  );
}
