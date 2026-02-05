"use client";

import { cn } from "@/lib/utils";

interface Props {
  currentStep: number;
  totalSteps: number;
}

export function ProgressIndicator({ currentStep, totalSteps }: Props) {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <div className="flex items-center gap-4">
      {/* Step count */}
      <span className="text-sm text-gray-500 dark:text-gray-400">
        Step {currentStep + 1} of {totalSteps}
      </span>

      {/* Progress bar */}
      <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-600 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step dots (for small step counts) */}
      {totalSteps <= 8 && (
        <div className="hidden sm:flex gap-1.5">
          {Array.from({ length: totalSteps }).map((_, index) => (
            <div
              key={index}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                index < currentStep
                  ? "bg-primary-600"
                  : index === currentStep
                  ? "bg-primary-400 animate-pulse"
                  : "bg-gray-300 dark:bg-gray-600"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
