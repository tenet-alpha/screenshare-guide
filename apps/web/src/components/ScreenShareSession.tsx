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

interface VerifiedStep {
  stepIndex: number;
  data: ExtractedDataItem[];
}

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
  const [verifiedSteps, setVerifiedSteps] = useState<VerifiedStep[]>([]);
  const [collectedData, setCollectedData] = useState<ExtractedDataItem[]>([]);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipWindowRef = useRef<any>(null);

  const steps = template.steps as TemplateStep[];
  const totalSteps = steps.length;
  const stepLabels = ["Handle Verification", "Analytics Verification"];

  useEffect(() => {
    setPipSupported("documentPictureInPicture" in window);
  }, []);

  // Keep PiP in sync
  useEffect(() => {
    updatePipContent();
  }, [instruction, currentStep, isAnalyzing, verifiedSteps, collectedData]);

  // Close PiP on completion
  useEffect(() => {
    if (status === "completed" && pipWindowRef.current) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
    }
  }, [status]);

  function updatePipContent() {
    const pipDoc = pipWindowRef.current?.document;
    if (!pipDoc) return;

    const dataHtml = collectedData.map((d) =>
      `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
        <span style="color:#9ca3af;font-size:12px;">${d.label}:</span>
        <span style="color:#fff;font-size:14px;font-weight:700;">${d.value}</span>
      </div>`
    ).join("");

    const analyzingHtml = isAnalyzing
      ? `<div style="display:flex;align-items:center;gap:6px;padding:8px 0 0;"><div style="width:8px;height:8px;background:#3b82f6;border-radius:50%;animation:pulse 1s infinite;"></div><span style="color:#93c5fd;font-size:12px;">Analyzing your screen...</span></div>`
      : "";

    const safeStep = Math.min(currentStep, totalSteps - 1);

    pipDoc.body.innerHTML = `
      <div style="padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
          <div style="background:#6366f1;color:#fff;font-size:13px;font-weight:700;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${safeStep + 1}
          </div>
          <div style="color:#fff;font-size:15px;font-weight:600;line-height:1.4;">
            ${instruction || steps[safeStep]?.instruction || "Loading..."}
          </div>
        </div>
        ${dataHtml ? `<div style="border-top:1px solid #374151;padding-top:8px;margin-top:4px;">${dataHtml}</div>` : ""}
        ${analyzingHtml}
      </div>
    `;
  }

  async function openPipWindow() {
    if (!("documentPictureInPicture" in window)) return;
    try {
      const pip = await (window as any).documentPictureInPicture.requestWindow({
        width: 380,
        height: 200,
      });
      pipWindowRef.current = pip;
      const style = pip.document.createElement("style");
      style.textContent = `
        body { margin: 0; background: #1f2937; overflow: hidden; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
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
        // Always accumulate extracted data as it arrives
        if (data.extractedData?.length) {
          accumulateData(data.extractedData);
        }
        // Track which step this data belongs to
        if (data.matchesSuccess && data.extractedData?.length) {
          const stepData = data.extractedData.filter((d: ExtractedDataItem) => d.label && d.value);
          if (stepData.length > 0) {
            setVerifiedSteps((prev) => [
              ...prev.filter((v) => v.stepIndex !== currentStep),
              { stepIndex: currentStep, data: stepData },
            ]);
          }
        }
        break;

      case "stepComplete": {
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
        setStatus("completed");
        stopScreenShare();
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
        video: { displaySurface: "monitor", frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
      streamRef.current = stream;
      // Hidden video element just for frame capture
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
      canvas.width = Math.min(video.videoWidth, 1280);
      canvas.height = Math.min(video.videoHeight, (canvas.width / video.videoWidth) * video.videoHeight);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      wsRef.current.send(JSON.stringify({ type: "frame", imageData: canvas.toDataURL("image/jpeg", 0.7) }));
    }, 2000);
  };

  const requestHint = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "requestHint" }));
  };

  useEffect(() => { return () => { stopScreenShare(); }; }, []);
  useEffect(() => {
    const hb = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "ping" }));
    }, 30000);
    return () => clearInterval(hb);
  }, []);

  const safeStep = Math.min(currentStep, totalSteps - 1);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Hidden video + canvas for frame capture only */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold">{template.name}</h1>
          <span className="text-sm text-gray-500">Step {safeStep + 1} of {totalSteps}</span>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full flex flex-col items-center justify-center">
        {error && (
          <div className="w-full mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">{error}</div>
        )}

        {/* ===== IDLE ===== */}
        {status === "idle" && (
          <div className="text-center max-w-md">
            <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-3">Ready to Verify?</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Share your screen and follow the floating instructions to verify your Instagram account.
            </p>
            <button onClick={startScreenShare} className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg text-lg transition-colors">
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
                <div className="bg-primary-500 text-white text-sm font-bold rounded-full w-8 h-8 flex items-center justify-center shrink-0">
                  {safeStep + 1}
                </div>
                <div className="flex-1">
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {instruction || steps[safeStep]?.instruction || "Loading..."}
                  </p>
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
              <AudioPlayer audioData={audioData} onComplete={() => setAudioData(null)} />
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              {pipSupported && (
                <button onClick={openPipWindow} className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/20 hover:bg-indigo-200 text-indigo-700 dark:text-indigo-400 rounded-lg text-sm font-medium transition-colors">
                  📌 Float Instructions
                </button>
              )}
              <button onClick={requestHint} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">
                Get Hint
              </button>
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
              <a href="/" className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors inline-block">
                Back to Home
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
