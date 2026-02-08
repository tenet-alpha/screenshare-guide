import { useRef, useState, useEffect, useCallback } from "react";
import type { ProofStep, ExtractedDataItem } from "@screenshare-guide/protocol";

interface UsePiPOptions {
  steps: ProofStep[];
  totalSteps: number;
  currentStep: number;
  instruction: string;
  isAnalyzing: boolean;
  collectedData: ExtractedDataItem[];
  completedSteps: Set<number>;
  status: string;
  onStepLinkClick: (stepIndex: number) => void;
}

export function usePiP({
  steps,
  totalSteps,
  currentStep,
  instruction,
  isAnalyzing,
  collectedData,
  completedSteps,
  status,
  onStepLinkClick,
}: UsePiPOptions) {
  const [pipSupported, setPipSupported] = useState(false);
  const pipWindowRef = useRef<any>(null);

  useEffect(() => {
    setPipSupported("documentPictureInPicture" in window);
  }, []);

  const updatePipContent = useCallback(() => {
    const pipDoc = pipWindowRef.current?.document;
    if (!pipDoc) return;

    const safeStep = Math.min(currentStep, totalSteps - 1);
    const stepLink = steps[safeStep]?.link;

    // Build completed steps markers
    const stepsHtml = Array.from({ length: totalSteps }, (_, i) => {
      const isComplete = completedSteps.has(i);
      const isCurrent = i === safeStep;
      const bg = isComplete ? "#22c55e" : isCurrent ? "#6366f1" : "#4b5563";
      const icon = isComplete
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`
        : `${i + 1}`;
      return `<div style="background:${bg};color:#fff;font-size:11px;font-weight:700;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">${icon}</div>`;
    }).join('<div style="flex:1;height:2px;background:#374151;"></div>');

    const dataHtml = collectedData.map((d) =>
      `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
        <span style="color:#9ca3af;font-size:11px;">${d.label}:</span>
        <span style="color:#fff;font-size:13px;font-weight:700;">${d.value}</span>
      </div>`
    ).join("");

    const analyzingHtml = isAnalyzing
      ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 0 0;">
          <div style="width:8px;height:8px;background:#3b82f6;border-radius:50%;animation:pulse 1s infinite;box-shadow:0 0 8px rgba(59,130,246,0.6);"></div>
          <span style="color:#93c5fd;font-size:12px;font-weight:500;">Analyzing your screen...</span>
        </div>`
      : "";

    // Clickable link button for steps with links
    const linkBtnHtml = stepLink
      ? `<button id="step-link" style="display:block;width:100%;margin-top:8px;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-align:center;">${stepLink.label}</button>`
      : "";

    const instructionText = instruction || steps[safeStep]?.instruction || "Loading...";

    pipDoc.body.innerHTML = `
      <div style="padding:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:8px;flex-shrink:0;">${stepsHtml}</div>
        ${linkBtnHtml ? `<div style="flex-shrink:0;margin-bottom:8px;">${linkBtnHtml.replace('margin-top:8px;', '')}</div>` : ""}
        <div style="color:#fff;font-size:13px;font-weight:600;line-height:1.3;flex-shrink:0;margin-bottom:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
          ${instructionText}
        </div>
        ${dataHtml ? `<div style="border-top:1px solid #374151;padding-top:4px;margin-top:4px;flex-shrink:0;overflow:hidden;">${dataHtml}</div>` : ""}
        ${analyzingHtml}
      </div>
    `;

    // Attach click handler to the link button
    if (stepLink) {
      const btn = pipDoc.getElementById("step-link");
      if (btn) {
        btn.addEventListener("click", () => onStepLinkClick(safeStep));
      }
    }
  }, [currentStep, totalSteps, steps, instruction, isAnalyzing, collectedData, completedSteps, onStepLinkClick]);

  // Keep PiP in sync with state
  useEffect(() => {
    updatePipContent();
  }, [updatePipContent]);

  // On completion: show countdown in PiP, then close it
  useEffect(() => {
    if (status === "completed") {
      const pip = pipWindowRef.current;
      if (pip) {
        let count = 3;
        const showCount = () => {
          if (!pipWindowRef.current) return;
          pipWindowRef.current.document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              <div style="width:48px;height:48px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
              </div>
              <div style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px;">Verification Complete!</div>
              <div style="color:#9ca3af;font-size:13px;">Closing in ${count}...</div>
            </div>
          `;
        };
        showCount();
        const timer = setInterval(() => {
          count--;
          if (count <= 0) {
            clearInterval(timer);
            if (pipWindowRef.current) {
              pipWindowRef.current.close();
              pipWindowRef.current = null;
            }
          } else {
            showCount();
          }
        }, 1000);
        return () => clearInterval(timer);
      }
    }
  }, [status]);

  const openPip = useCallback(async () => {
    if (!("documentPictureInPicture" in window)) return;
    try {
      const pip = await (window as any).documentPictureInPicture.requestWindow({
        width: 380,
        height: 240,
      });
      pipWindowRef.current = pip;
      const style = pip.document.createElement("style");
      style.textContent = `
        body { margin: 0; background: #1f2937; overflow: hidden; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes shimmer { 0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); } 50% { box-shadow: 0 0 12px 4px rgba(59,130,246,0.2); } 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); } }
        button:hover { filter: brightness(1.1); }
      `;
      pip.document.head.appendChild(style);
      pip.addEventListener("pagehide", () => { pipWindowRef.current = null; });
      updatePipContent();
    } catch (err) {
      console.error("Failed to open PiP:", err);
    }
  }, [updatePipContent]);

  const closePip = useCallback(() => {
    if (pipWindowRef.current) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
    }
  }, []);

  return {
    pipSupported,
    pipWindowRef,
    openPip,
    closePip,
  };
}
