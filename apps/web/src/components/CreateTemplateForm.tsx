"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface Step {
  instruction: string;
  successCriteria: string;
  hints: string[];
}

export function CreateTemplateForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<Step[]>([
    { instruction: "", successCriteria: "", hints: [] },
  ]);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const createTemplate = trpc.template.create.useMutation({
    onSuccess: () => {
      // Reset form
      setName("");
      setDescription("");
      setSteps([{ instruction: "", successCriteria: "", hints: [] }]);
      setError(null);
      // Invalidate templates list
      utils.template.list.invalidate();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const addStep = () => {
    setSteps([...steps, { instruction: "", successCriteria: "", hints: [] }]);
  };

  const removeStep = (index: number) => {
    if (steps.length > 1) {
      setSteps(steps.filter((_, i) => i !== index));
    }
  };

  const updateStep = (index: number, field: keyof Step, value: string | string[]) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }

    const validSteps = steps.filter(
      (s) => s.instruction.trim() && s.successCriteria.trim()
    );

    if (validSteps.length === 0) {
      setError("At least one complete step is required");
      return;
    }

    createTemplate.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      steps: validSteps.map((s) => ({
        instruction: s.instruction.trim(),
        successCriteria: s.successCriteria.trim(),
        hints: s.hints.filter((h) => h.trim()),
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Template Name */}
      <div>
        <label className="block text-sm font-medium mb-2">Template Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Instagram Demographics Guide"
          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-2">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this template guides users through"
          rows={2}
          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      {/* Steps */}
      <div>
        <label className="block text-sm font-medium mb-2">Steps</label>
        <div className="space-y-4">
          {steps.map((step, index) => (
            <div
              key={index}
              className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium">Step {index + 1}</span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Instruction (what to tell the user)
                  </label>
                  <input
                    type="text"
                    value={step.instruction}
                    onChange={(e) => updateStep(index, "instruction", e.target.value)}
                    placeholder="e.g., Open the Instagram app and go to your profile"
                    className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Success Criteria (what indicates completion)
                  </label>
                  <input
                    type="text"
                    value={step.successCriteria}
                    onChange={(e) => updateStep(index, "successCriteria", e.target.value)}
                    placeholder="e.g., Profile page is visible with user's avatar and bio"
                    className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Hints (optional, comma-separated)
                  </label>
                  <input
                    type="text"
                    value={step.hints.join(", ")}
                    onChange={(e) =>
                      updateStep(
                        index,
                        "hints",
                        e.target.value.split(",").map((h) => h.trim())
                      )
                    }
                    placeholder="e.g., Tap your profile picture, Look for the person icon"
                    className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addStep}
          className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          + Add Step
        </button>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={createTemplate.isPending}
        className={cn(
          "w-full py-3 px-4 rounded-lg font-medium text-white transition-colors",
          createTemplate.isPending
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-primary-600 hover:bg-primary-700"
        )}
      >
        {createTemplate.isPending ? "Creating..." : "Create Template"}
      </button>
    </form>
  );
}
