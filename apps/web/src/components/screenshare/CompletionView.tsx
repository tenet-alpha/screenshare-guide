import { cn } from "@/lib/utils";
import { CheckIcon } from "./CheckIcon";
import type { ExtractedDataItem } from "@screenshare-guide/protocol";
import type { UploadStatus } from "./types";

interface CompletionViewProps {
  template: {
    name: string;
    completionMessage?: string;
  };
  collectedData: ExtractedDataItem[];
  uploadStatus: UploadStatus;
  onCopy: () => void;
  copied: boolean;
}

export function CompletionView({ template, collectedData, uploadStatus, onCopy, copied }: CompletionViewProps) {
  return (
    <div className="w-full max-w-lg">
      {/* Success header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Verification Successful</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">{template.completionMessage || "Your data has been verified."}</p>
      </div>

      {/* Results card */}
      {collectedData.length > 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Handle section */}
          {collectedData.find(d => d.label === "Handle") && (
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 text-center">
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Verified Account</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {collectedData.find(d => d.label === "Handle")?.value}
              </p>
            </div>
          )}

          {/* Metrics section */}
          <div className="px-6 py-5">
            <div className="grid grid-cols-3 gap-4">
              {collectedData.filter(d => d.label !== "Handle").map((d, j) => (
                <div key={j} className="text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{d.value}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-center gap-2">
            <CheckIcon className="w-3.5 h-3.5 text-green-500" />
            <p className="text-xs text-gray-400">
              Verified via live screen analysis • {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-500">Session completed.</p>
        </div>
      )}

      {/* Recording status — subtle */}
      {uploadStatus === "uploading" && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-gray-400">Saving recording...</span>
        </div>
      )}
      {uploadStatus === "done" && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <CheckIcon className="w-3 h-3 text-green-500" />
          <span className="text-xs text-gray-400">Recording saved</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-center gap-3 mt-6">
        {collectedData.length > 0 && (
          <button
            onClick={onCopy}
            className={cn(
              "px-5 py-2.5 rounded-xl text-sm font-medium transition-all inline-flex items-center gap-2 border",
              copied
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            )}
          >
            {copied ? (
              <>
                <CheckIcon className="w-4 h-4" />
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Results
              </>
            )}
          </button>
        )}
        <a href="/" className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-medium rounded-xl text-sm transition-all">
          New Verification
        </a>
      </div>
    </div>
  );
}
