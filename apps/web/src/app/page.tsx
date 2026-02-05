"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CreateTemplateForm } from "@/components/CreateTemplateForm";
import { TemplateList } from "@/components/TemplateList";
import { SessionList } from "@/components/SessionList";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"templates" | "sessions">("templates");

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-12 text-center">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-primary-600 to-primary-400 bg-clip-text text-transparent">
            ScreenShare Guide
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            AI-powered guidance for screen sharing sessions
          </p>
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-4 mb-8 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("templates")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "templates"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Templates
          </button>
          <button
            onClick={() => setActiveTab("sessions")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "sessions"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Sessions
          </button>
        </div>

        {/* Content */}
        {activeTab === "templates" ? (
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold mb-4">Create Template</h2>
              <CreateTemplateForm />
            </div>
            <div>
              <h2 className="text-2xl font-semibold mb-4">Your Templates</h2>
              <TemplateList />
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-2xl font-semibold mb-4">Active Sessions</h2>
            <SessionList />
          </div>
        )}
      </div>
    </main>
  );
}
