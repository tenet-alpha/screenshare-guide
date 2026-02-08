import type { ProofStep } from "@screenshare-guide/protocol";

interface StickyInstructionBarProps {
  safeStep: number;
  instruction: string;
  steps: ProofStep[];
  isAnalyzing: boolean;
  onLinkClick: (stepIndex: number) => void;
}

export function StickyInstructionBar({ safeStep, instruction, steps, isAnalyzing, onLinkClick }: StickyInstructionBarProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur-sm border-b border-gray-700 px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <div className="bg-purple-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shrink-0">
          {safeStep + 1}
        </div>
        <p className="text-sm font-medium text-white truncate flex-1">
          {instruction || steps[safeStep]?.instruction || "Loading..."}
        </p>
        {steps[safeStep]?.link && (
          <button
            onClick={() => onLinkClick(safeStep)}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md transition-colors shrink-0"
          >
            {steps[safeStep].link!.label}
          </button>
        )}
        {isAnalyzing && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.6)]"></div>
            <span className="text-xs text-blue-300">Analyzing...</span>
          </div>
        )}
      </div>
    </div>
  );
}
