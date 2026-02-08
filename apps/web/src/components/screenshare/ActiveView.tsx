import { cn } from "@/lib/utils";
import { AudioPlayer } from "../AudioPlayer";
import { CheckIcon } from "./CheckIcon";
import type { ProofStep, ExtractedDataItem } from "@screenshare-guide/protocol";

interface ActiveViewProps {
  steps: ProofStep[];
  safeStep: number;
  instruction: string;
  isAnalyzing: boolean;
  collectedData: ExtractedDataItem[];
  linkClickedSteps: Set<number>;
  audioData: string | null;
  pipSupported: boolean;
  onLinkClick: (stepIndex: number) => void;
  onOpenPip: () => void;
  onStop: () => void;
  onAudioComplete: () => void;
}

export function ActiveView({
  steps,
  safeStep,
  instruction,
  isAnalyzing,
  collectedData,
  linkClickedSteps,
  audioData,
  pipSupported,
  onLinkClick,
  onOpenPip,
  onStop,
  onAudioComplete,
}: ActiveViewProps) {
  return (
    <div className="w-full space-y-6">
      {/* Improvement #4: Enhanced analysis feedback — pulse border on instruction card */}
      <div className={cn(
        "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-all duration-300",
        isAnalyzing && "border-blue-400/60 dark:border-blue-500/50 shadow-[0_0_15px_-3px_rgba(59,130,246,0.3)] animate-[analyzing-pulse_2s_ease-in-out_infinite]"
      )}>
        <div className="flex items-start gap-4">
          <div className="bg-purple-500 text-white text-sm font-bold rounded-full w-8 h-8 flex items-center justify-center shrink-0">
            {safeStep + 1}
          </div>
          <div className="flex-1">
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {instruction || steps[safeStep]?.instruction || "Loading..."}
            </p>
            {/* Step link */}
            {steps[safeStep]?.link && (
              <button
                onClick={() => onLinkClick(safeStep)}
                className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {steps[safeStep].link!.label}
              </button>
            )}
            {/* Improvement #3: Show waiting message if link not clicked yet */}
            {steps[safeStep]?.link && !linkClickedSteps.has(safeStep) && (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                👆 Click the link above to open the page, then analysis will begin.
              </p>
            )}
            {safeStep === 1 && linkClickedSteps.has(1) && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Analyzing your insights data...
              </p>
            )}
            {/* Improvement #4: More visible analyzing indicator */}
            {isAnalyzing && (
              <div className="flex items-center gap-2.5 mt-3 text-blue-600 dark:text-blue-400">
                <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
                <span className="text-sm font-medium">Analyzing your screen...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Verified data so far */}
      {collectedData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
            Extracted Data
          </h3>
          {collectedData.map((d, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <CheckIcon className="w-5 h-5 text-green-500 shrink-0" />
              <span className="text-sm text-gray-500 dark:text-gray-400">{d.label}</span>
              <span className="ml-auto text-base font-bold text-gray-900 dark:text-gray-100">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Audio player */}
      {audioData && (
        <AudioPlayer audioData={audioData} onComplete={onAudioComplete} />
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {pipSupported && (
          <button onClick={onOpenPip} className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/20 hover:bg-indigo-200 text-indigo-700 dark:text-indigo-400 rounded-lg text-sm font-medium transition-colors">
            📌 Float Instructions
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onStop} className="px-4 py-2 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium transition-colors">
          Stop Session
        </button>
      </div>
    </div>
  );
}
