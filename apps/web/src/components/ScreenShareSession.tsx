"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ExtractedDataItem, ProofStep } from "@screenshare-guide/protocol";

import { useWebSocket } from "./screenshare/hooks/useWebSocket";
import { useFrameCapture } from "./screenshare/hooks/useFrameCapture";
import { usePiP } from "./screenshare/hooks/usePiP";
import { useRecording } from "./screenshare/hooks/useRecording";

import { CheckIcon } from "./screenshare/CheckIcon";
import { LandingView } from "./screenshare/LandingView";
import { ActiveView } from "./screenshare/ActiveView";
import { CompletionView } from "./screenshare/CompletionView";
import { StickyInstructionBar } from "./screenshare/StickyInstructionBar";

import type { SessionStatus } from "./screenshare/types";

interface Props {
  token: string;
  sessionId: string;
  template: {
    id: string;
    name: string;
    description?: string;
    completionMessage?: string;
    steps: ProofStep[];
  };
  initialStep: number;
}

export function ScreenShareSession({ token, sessionId, template, initialStep }: Props) {
  // ── Shared state ──────────────────────────────────────────────────
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [currentStep, setCurrentStep] = useState(Math.min(initialStep, template.steps.length - 1));
  const [instruction, setInstruction] = useState<string>("");
  const [collectedData, setCollectedData] = useState<ExtractedDataItem[]>([]);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [linkClickedSteps, setLinkClickedSteps] = useState<Set<number>>(new Set());

  // Defensive: ensure steps is always a valid array
  const steps: ProofStep[] = (() => {
    try {
      if (Array.isArray(template.steps)) return template.steps;
      if (typeof template.steps === "string") return JSON.parse(template.steps);
      return [];
    } catch {
      return [];
    }
  })();
  const totalSteps = steps.length;
  const safeStep = Math.min(currentStep, Math.max(totalSteps - 1, 0));

  // Refs that mirror state for use inside setInterval closures
  const currentStepRef = useRef(currentStep);
  const linkClickedStepsRef = useRef(linkClickedSteps);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { linkClickedStepsRef.current = linkClickedSteps; }, [linkClickedSteps]);

  // ── Accumulate extracted data ─────────────────────────────────────
  const accumulateData = useCallback((items: ExtractedDataItem[]) => {
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
  }, []);

  // ── WebSocket message handler ─────────────────────────────────────
  const handleWebSocketMessage = useCallback((data: any) => {
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
        setAudioData(data.audioData);
        break;
      case "instruction":
        break;
      case "completed":
        if (data.extractedData?.length) {
          accumulateData(data.extractedData);
        }
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(totalSteps - 1);
          return next;
        });
        setStatus("completed");
        break;
      case "error":
        setError(data.message);
        setStatus("error");
        break;
      case "pong":
        break;
    }
  }, [totalSteps, accumulateData]);

  // ── Hooks ─────────────────────────────────────────────────────────
  const { wsRef, connect: connectWebSocket, disconnect: disconnectWs, send: wsSend } = useWebSocket({
    token,
    onMessage: handleWebSocketMessage,
    onConnected: () => setStatus("ready"),
    onError: (msg) => { setError(msg); setStatus("error"); },
  });

  const { videoRef, canvasRef, streamRef, startCapture, stopCapture } = useFrameCapture({
    wsRef,
    steps,
    currentStepRef,
    linkClickedStepsRef,
  });

  const { startRecording, stopRecording, uploadRecording, uploadStatus, cleanup: cleanupRecording } = useRecording({
    sessionId,
  });

  // ── handleStepLinkClick — shared between views and PiP ────────────
  const handleStepLinkClick = useCallback((stepIndex: number) => {
    const link = steps[stepIndex]?.link;
    if (!link) return;
    window.open(link.url, "_blank");
    setLinkClickedSteps((prev) => {
      const next = new Set(prev);
      next.add(stepIndex);
      return next;
    });
    wsSend({ type: "linkClicked", step: stepIndex });
  }, [steps, wsSend]);

  const { pipSupported, pipWindowRef, openPip, closePip } = usePiP({
    steps,
    totalSteps,
    currentStep,
    instruction,
    isAnalyzing,
    collectedData,
    completedSteps,
    status,
    onStepLinkClick: handleStepLinkClick,
  });

  // ── Stop screen share ─────────────────────────────────────────────
  const stopScreenShare = useCallback((keepStatus = false) => {
    stopCapture();
    stopRecording();
    disconnectWs();
    if (!keepStatus) {
      closePip();
      setStatus("idle");
    }
  }, [stopCapture, stopRecording, disconnectWs, closePip]);

  // When status becomes "completed", stop sharing (keepStatus=true) and upload
  useEffect(() => {
    if (status === "completed") {
      // Stop capture/recording but don't reset status
      stopCapture();
      stopRecording();
      disconnectWs();
      // Upload recording (non-blocking)
      uploadRecording();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start screen share ────────────────────────────────────────────
  const startScreenShare = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const stream = await startCapture();

      // Start recording
      startRecording(stream);

      // Listen for track ended (user stops sharing via browser UI)
      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => stopScreenShare());

      // Connect WebSocket
      connectWebSocket();

      setStatus("active");

      // Auto-open PiP
      if ("documentPictureInPicture" in window) {
        setTimeout(() => openPip(), 1000);
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Screen sharing permission was denied. Please try again.");
      } else if (err.message?.includes("entire screen")) {
        setError(err.message);
      } else {
        setError("Failed to start screen sharing. Please try again.");
      }
      setStatus("error");
    }
  }, [startCapture, startRecording, connectWebSocket, openPip, stopScreenShare]);

  // ── Cleanup on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopScreenShare();
      cleanupRecording();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audio complete handler ────────────────────────────────────────
  const handleAudioComplete = useCallback(() => {
    setAudioData(null);
    wsSend({ type: "audioComplete" });
  }, [wsSend]);

  // ── Copy results ──────────────────────────────────────────────────
  const handleCopyResults = useCallback(async () => {
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const lines = collectedData.map((d) => `${d.label}: ${d.value}`).join("\n");
    const text = `${template.name} — Verified ${dateStr}\n\n${lines}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [collectedData, template.name]);

  // ── Guard: no steps ───────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Off-screen video + canvas for frame capture */}
      <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }} />
      <canvas ref={canvasRef} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }} />

      {/* Sticky instruction bar for non-PiP browsers */}
      {status === "active" && !pipSupported && (
        <StickyInstructionBar
          safeStep={safeStep}
          instruction={instruction}
          steps={steps}
          isAnalyzing={isAnalyzing}
          onLinkClick={handleStepLinkClick}
        />
      )}

      {/* Header */}
      <header className={cn(
        "bg-white dark:bg-gray-800 shadow-sm p-4 border-b border-gray-200 dark:border-gray-700",
        status === "active" && !pipSupported && "mt-12"
      )}>
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
            {template.name}
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

        {status === "idle" && (
          <LandingView
            template={template}
            steps={steps}
            pipSupported={pipSupported}
            onStart={startScreenShare}
          />
        )}

        {(status === "active" || status === "ready" || status === "connecting") && (
          <ActiveView
            steps={steps}
            safeStep={safeStep}
            instruction={instruction}
            isAnalyzing={isAnalyzing}
            collectedData={collectedData}
            linkClickedSteps={linkClickedSteps}
            audioData={audioData}
            pipSupported={pipSupported}
            onLinkClick={handleStepLinkClick}
            onOpenPip={openPip}
            onStop={() => stopScreenShare()}
            onAudioComplete={handleAudioComplete}
          />
        )}

        {status === "completed" && (
          <CompletionView
            template={template}
            collectedData={collectedData}
            uploadStatus={uploadStatus}
            onCopy={handleCopyResults}
            copied={copied}
          />
        )}
      </main>
    </div>
  );
}
