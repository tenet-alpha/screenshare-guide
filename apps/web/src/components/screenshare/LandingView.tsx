import { cn } from "@/lib/utils";
import type { ProofStep } from "@screenshare-guide/protocol";

interface LandingViewProps {
  template: {
    name: string;
    description?: string;
  };
  steps: ProofStep[];
  pipSupported: boolean;
  onStart: () => void;
}

export function LandingView({ template, steps, pipSupported, onStart }: LandingViewProps) {
  return (
    <div className="text-center max-w-lg">
      {/* Hero */}
      <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg">
        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">{template.name}</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-8">
        {template.description || `${steps.length} quick steps to verify your audience metrics.`}
      </p>

      {/* Steps explanation — dynamically generated from template */}
      <div className="flex gap-4 mb-8 text-left">
        {steps.map((step, i) => {
          const colors = [
            { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-600 dark:text-purple-400" },
            { bg: "bg-pink-100 dark:bg-pink-900/30", text: "text-pink-600 dark:text-pink-400" },
            { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-600 dark:text-blue-400" },
            { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-600 dark:text-emerald-400" },
          ];
          const color = colors[i % colors.length];
          return (
            <div key={i} className="flex-1 bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-3", color.bg, color.text)}>{i + 1}</div>
              <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">{step.title || step.link?.label?.replace(" →", "") || step.instruction}</h3>
              {step.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{step.description}</p>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={onStart} className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-semibold rounded-xl text-lg transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]">
        Share Screen & Start
      </button>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
        Your screen is only analyzed in real-time — nothing is stored except the verified metrics.
      </p>

      {!pipSupported && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
          ⚠️ Use Chrome for the best experience (floating instruction overlay).
        </p>
      )}
    </div>
  );
}
