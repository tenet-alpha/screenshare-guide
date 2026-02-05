"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface TemplateStep {
  instruction: string;
  successCriteria: string;
  hints?: string[];
}

export function TemplateList() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const { data: templates, isLoading, error } = trpc.template.list.useQuery();
  const utils = trpc.useUtils();

  const createSession = trpc.session.create.useMutation({
    onSuccess: (session) => {
      // Copy URL to clipboard
      const url = `${window.location.origin}${session.shareUrl}`;
      navigator.clipboard.writeText(url);
      setCopiedUrl(session.token);
      setTimeout(() => setCopiedUrl(null), 3000);
      // Refresh sessions list
      utils.session.list.invalidate();
    },
  });

  const deleteTemplate = trpc.template.delete.useMutation({
    onSuccess: () => {
      utils.template.list.invalidate();
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner text-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
        Failed to load templates: {error.message}
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No templates yet.</p>
        <p className="text-sm mt-2">Create your first template to get started!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {templates.map((template) => {
        const steps = template.steps as TemplateStep[];
        const isExpanded = expandedId === template.id;

        return (
          <div
            key={template.id}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            {/* Header */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : template.id)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">{template.name}</h3>
                  {template.description && (
                    <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {steps.length} step{steps.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      createSession.mutate({ templateId: template.id });
                    }}
                    disabled={createSession.isPending}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                      copiedUrl
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-900/30 dark:text-primary-400"
                    )}
                  >
                    {createSession.isPending
                      ? "Creating..."
                      : copiedUrl
                      ? "✓ Link Copied!"
                      : "Create Link"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this template?")) {
                        deleteTemplate.mutate({ id: template.id });
                      }
                    }}
                    className="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>

            {/* Expanded Steps */}
            {isExpanded && (
              <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/50">
                <h4 className="text-sm font-medium mb-3">Steps:</h4>
                <ol className="space-y-3">
                  {steps.map((step, index) => (
                    <li key={index} className="text-sm">
                      <div className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium">{step.instruction}</p>
                          <p className="text-gray-500 text-xs mt-1">
                            Success: {step.successCriteria}
                          </p>
                          {step.hints && step.hints.length > 0 && (
                            <p className="text-gray-400 text-xs mt-1">
                              Hints: {step.hints.join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
