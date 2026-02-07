"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./AudioPlayer";

interface TemplateStep {
  instruction: string;
  successCriteria: string;
  hints?: string[];
}

interface Props {
  token: string;
  sessionId: string;
  template: {
    id: string;
    name: string;
    steps: TemplateStep[];
  };
  initialStep: number;
}

type SessionStatus = "idle" | "connecting" | "ready" | "active" | "completed" | "error";

interface ExtractedDataItem {
  label: string;
  value: string;
}

// Step link URLs for the Instagram proof flow
const STEP_LINKS: Record<number, { url: string; label: string }> = {
  0: { url: "https://business.facebook.com/latest/home", label: "Open Meta Business Suite →" },
  1: { url: "https://business.facebook.com/latest/insights/", label: "Open Insights →" },
};

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("w-5 h-5", className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function ScreenShareSession({ token, sessionId, template, initialStep }: Props) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [currentStep, setCurrentStep] = useState(Math.min(initialStep, template.steps.length - 1));
  const [instruction, setInstruction] = useState<string>("");
  const [collectedData, setCollectedData] = useState<ExtractedDataItem[]>([]);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipWindowRef = useRef<any>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Defensive: ensure steps is always a valid array
  const steps: TemplateStep[] = (() => {
    try {
      if (Array.isArray(template.steps)) return template.steps;
      if (typeof template.steps === "string") return JSON.parse(template.steps);
      return [];
    } catch {
      return [];
    }
  })();
  const totalSteps = steps.length;

  useEffect(() => {
    setPipSupported("documentPictureInPicture" in window);
  }, []);

  // Keep PiP in sync
  useEffect(() => {
    updatePipContent();
  }, [instruction, currentStep, isAnalyzing, collectedData, countdown, completedSteps]);

  // Close PiP on completion
  useEffect(() => {
    if (status === "completed" && pipWindowRef.current) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
    }
  }, [status]);

  // Countdown logic
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setStatus("completed");
      stopScreenShare();
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  function handleStepLinkClick(stepIndex: number) {
    const link = STEP_LINKS[stepIndex];
    if (!link) return;
    window.open(link.url, "_blank");
    // Send linkClicked to backend
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "linkClicked", step: stepIndex + 1 }));
    }
  }

  function updatePipContent() {
    const pipDoc = pipWindowRef.current?.document;
    if (!pipDoc) return;

    const safeStep = Math.min(currentStep, totalSteps - 1);
    const stepLink = STEP_LINKS[safeStep];

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
      ? `<div style="display:flex;align-items:center;gap:6px;padding:6px 0 0;"><div style="width:6px;height:6px;background:#3b82f6;border-radius:50%;animation:pulse 1s infinite;"></div><span style="color:#93c5fd;font-size:11px;">Analyzing...</span></div>`
      : "";

    const countdownHtml = countdown !== null
      ? `<div style="text-align:center;padding:8px 0;color:#22c55e;font-size:20px;font-weight:700;">Closing in ${countdown}...</div>`
      : "";

    // Clickable link button for steps 1 and 2
    const linkBtnHtml = stepLink && countdown === null
      ? `<button id="step-link" style="display:block;width:100%;margin-top:8px;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-align:center;">${stepLink.label}</button>`
      : "";

    const instructionText = countdown !== null
      ? "✅ All metrics captured!"
      : instruction || steps[safeStep]?.instruction || "Loading...";

    pipDoc.body.innerHTML = `
      <div style="padding:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:10px;">${stepsHtml}</div>
        <div style="color:#fff;font-size:14px;font-weight:600;line-height:1.4;margin-bottom:4px;">
          ${instructionText}
        </div>
        ${linkBtnHtml}
        ${dataHtml ? `<div style="border-top:1px solid #374151;padding-top:6px;margin-top:6px;">${dataHtml}</div>` : ""}
        ${analyzingHtml}
        ${countdownHtml}
      </div>
    `;

    // Attach click handler to the link button
    if (stepLink && countdown === null) {
      const btn = pipDoc.getElementById("step-link");
      if (btn) {
        btn.addEventListener("click", () => handleStepLinkClick(safeStep));
      }
    }
  }

  async function openPipWindow() {
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
        button:hover { filter: brightness(1.1); }
      `;
      pip.document.head.appendChild(style);
      pip.addEventListener("pagehide", () => { pipWindowRef.current = null; });
      updatePipContent();
    } catch (err) {
      console.error("Failed to open PiP:", err);
    }
  }

  const connectWebSocket = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws/${token}`);
    ws.onopen = () => { setStatus("ready"); };
    ws.onmessage = (event) => {
      try { handleWebSocketMessage(JSON.parse(event.data)); }
      catch (err) { console.error("[WS] Parse error:", err); }
    };
    ws.onerror = () => { setError("Connection error. Please refresh the page."); setStatus("error"); };
    ws.onclose = () => {
      if (status !== "completed" && status !== "error") {
        setTimeout(() => { if (wsRef.current?.readyState !== WebSocket.OPEN) connectWebSocket(); }, 3000);
      }
    };
    wsRef.current = ws;
  }, [token, status]);

  // Accumulate extracted data (dedup by label, always keep latest)
  function accumulateData(items: ExtractedDataItem[]) {
    if (!items?.length) return;
    setCollectedData((prev) => {
      const updated = [...prev];
      for (const item of items) {
        if (!item.label || !item.value) continue;
        const idx = updated.findIndex((d) => d.label === item.label);
        if (idx >= 0) updated[idx] = item;
        else updated.push(item);
      }
      return updated;
    });
  }

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case "connected": {
        const clampedStep = Math.min(data.currentStep, totalSteps - 1);
        setCurrentStep(clampedStep);
        setInstruction(data.instruction);
        break;
      }

      case "analyzing":
        setIsAnalyzing(true);
        break;

      case "analysis":
        setIsAnalyzing(false);
        if (data.extractedData?.length) {
          accumulateData(data.extractedData);
        }
        break;

      case "stepComplete": {
        // Mark previous step as completed
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(data.currentStep - 1);
          return next;
        });
        const clampedStep = Math.min(data.currentStep, totalSteps - 1);
        setCurrentStep(clampedStep);
        setInstruction(data.nextInstruction);
        break;
      }

      case "audio":
        setInstruction(data.text);
        setAudioData(data.audioData);
        break;

      case "instruction":
        setInstruction(data.text);
        break;

      case "completed":
        // Accumulate any final data
        if (data.extractedData?.length) {
          accumulateData(data.extractedData);
        }
        // Mark the last step as completed
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(totalSteps - 1);
          return next;
        });
        // Start 5-second countdown
        setCountdown(5);
        break;

      case "error":
        setError(data.message);
        setStatus("error");
        break;

      case "pong":
        break;
    }
  };

  const startScreenShare = async () => {
    setStatus("connecting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: { ideal: 2, max: 5 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => stopScreenShare());
      connectWebSocket();
      startFrameSampling();
      setStatus("active");
      // Auto-open PiP
      if ("documentPictureInPicture" in window) {
        setTimeout(() => openPipWindow(), 1000);
      }
    } catch (err: any) {
      setError(err.name === "NotAllowedError"
        ? "Screen sharing permission was denied. Please try again."
        : "Failed to start screen sharing. Please try again.");
      setStatus("error");
    }
  };

  const stopScreenShare = () => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (pipWindowRef.current) { pipWindowRef.current.close(); pipWindowRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (status !== "completed") setStatus("idle");
  };

  const startFrameSampling = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    frameIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || video.readyState < 2) return;
      canvas.width = Math.min(video.videoWidth, 1024);
      canvas.height = Math.min(video.videoHeight, (canvas.width / video.videoWidth) * video.videoHeight);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      wsRef.current.send(JSON.stringify({ type: "frame", imageData: canvas.toDataURL("image/jpeg", 0.6) }));
    }, 1000);
  };

  useEffect(() => { return () => { stopScreenShare(); }; }, []);
  useEffect(() => {
    const hb = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "ping" }));
    }, 30000);
    return () => clearInterval(hb);
  }, []);

  const safeStep = Math.min(currentStep, Math.max(totalSteps - 1, 0));

  // Guard: if template has no steps, show an error
  if (totalSteps === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          <h1 className="text-xl font-semibold mb-2 text-red-600">Template Error</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Invalid template data. No steps available.
          </p>
          <a href="/" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white font-medium rounded-lg transition-all inline-block">
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Hidden video + canvas for frame capture only */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
            Instagram Audience Proof
          </h1>
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                  completedSteps.has(i)
                    ? "bg-green-500 text-white"
                    : i === safeStep
                    ? "bg-purple-500 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                )}
              >
                {completedSteps.has(i) ? (
                  <CheckIcon className="w-4 h-4 text-white" />
                ) : (
                  i + 1
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full flex flex-col items-center justify-center">
        {error && (
          <div className="w-full mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">{error}</div>
        )}

        {/* ===== IDLE ===== */}
        {status === "idle" && (
          <div className="text-center max-w-md">
            <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-3">Ready to Verify?</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              Share your screen and follow the floating instructions to verify your Instagram audience metrics.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
              3 quick steps: Open Meta Business Suite → View Insights → Capture metrics
            </p>
            <button onClick={startScreenShare} className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-medium rounded-xl text-lg transition-all shadow-lg hover:shadow-xl">
              Share Screen & Start
            </button>
            {!pipSupported && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                ⚠️ Use Chrome for the best experience (floating instruction overlay).
              </p>
            )}
          </div>
        )}

        {/* ===== ACTIVE ===== */}
        {(status === "active" || status === "ready" || status === "connecting") && (
          <div className="w-full space-y-6">
            {/* Current instruction card */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-start gap-4">
                <div className="bg-purple-500 text-white text-sm font-bold rounded-full w-8 h-8 flex items-center justify-center shrink-0">
                  {safeStep + 1}
                </div>
                <div className="flex-1">
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {instruction || steps[safeStep]?.instruction || "Loading..."}
                  </p>
                  {/* Step link */}
                  {STEP_LINKS[safeStep] && (
                    <button
                      onClick={() => handleStepLinkClick(safeStep)}
                      className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {STEP_LINKS[safeStep].label}
                    </button>
                  )}
                  {safeStep === 2 && (
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      Analyzing your insights data...
                    </p>
                  )}
                  {isAnalyzing && (
                    <div className="flex items-center gap-2 mt-3 text-blue-600 dark:text-blue-400">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="text-sm">Analyzing your screen...</span>
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

            {/* Countdown */}
            {countdown !== null && (
              <div className="text-center py-4">
                <p className="text-green-600 dark:text-green-400 font-semibold text-lg">
                  ✅ All metrics captured! Closing in {countdown}...
                </p>
              </div>
            )}

            {/* Audio player */}
            {audioData && (
              <AudioPlayer audioData={audioData} onComplete={() => setAudioData(null)} />
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              {pipSupported && (
                <button onClick={openPipWindow} className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/20 hover:bg-indigo-200 text-indigo-700 dark:text-indigo-400 rounded-lg text-sm font-medium transition-colors">
                  📌 Float Instructions
                </button>
              )}
              <div className="flex-1" />
              <button onClick={stopScreenShare} className="px-4 py-2 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium transition-colors">
                Stop Session
              </button>
            </div>
          </div>
        )}

        {/* ===== COMPLETED ===== */}
        {status === "completed" && (
          <div className="w-full max-w-lg">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckIcon className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Verification Complete</h2>
              <p className="text-gray-500 dark:text-gray-400">All data verified from your live screen.</p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Verified Instagram Data
                </h3>
              </div>
              <div className="p-6">
                {collectedData.length > 0 ? (
                  <div className="space-y-0">
                    {collectedData.map((d, j) => (
                      <div key={j} className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                        <div className="flex items-center gap-2">
                          <CheckIcon className="w-4 h-4 text-green-500" />
                          <span className="text-sm text-gray-600 dark:text-gray-400">{d.label}</span>
                        </div>
                        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{d.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">Session completed.</p>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-400 text-center">
                  Verified via live screen analysis • {new Date().toLocaleString()}
                </p>
              </div>
            </div>

            <div className="text-center mt-6">
              <a href="/" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-medium rounded-lg transition-all inline-block">
                Back to Home
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
