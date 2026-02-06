"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ProgressIndicator } from "./ProgressIndicator";
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
  verifiedAt: string;
}

interface AnalysisResult {
  description: string;
  matchesSuccess: boolean;
  confidence: number;
  extractedData?: ExtractedDataItem[];
}

// Checkmark icon component
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("w-5 h-5", className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function ScreenShareSession({ token, sessionId, template, initialStep }: Props) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [instruction, setInstruction] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [verifiedSteps, setVerifiedSteps] = useState<VerifiedStep[]>([]);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = template.steps as TemplateStep[];
  const totalSteps = steps.length;

  // Connect to WebSocket
  const connectWebSocket = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws/${token}`);

    ws.onopen = () => {
      console.log("[WS] Connected");
      setStatus("ready");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    ws.onerror = (event) => {
      console.error("[WS] Error:", event);
      setError("Connection error. Please refresh the page.");
      setStatus("error");
    };

    ws.onclose = () => {
      console.log("[WS] Disconnected");
      if (status !== "completed" && status !== "error") {
        setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            connectWebSocket();
          }
        }, 3000);
      }
    };

    wsRef.current = ws;
  }, [token, status]);

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case "connected":
        setCurrentStep(data.currentStep);
        setInstruction(data.instruction);
        break;

      case "analyzing":
        setIsAnalyzing(true);
        break;

      case "analysis":
        setIsAnalyzing(false);
        setAnalysis({
          description: data.description,
          matchesSuccess: data.matchesSuccess,
          confidence: data.confidence,
          extractedData: data.extractedData,
        });
        break;

      case "stepComplete": {
        // Save verified data for the completed step
        const completedStepIndex = data.currentStep - 1;
        const stepData = analysis?.extractedData?.filter((d: ExtractedDataItem) => d.label && d.value) || [];
        if (stepData.length > 0) {
          setVerifiedSteps((prev) => {
            const existing = prev.findIndex((v) => v.stepIndex === completedStepIndex);
            const entry: VerifiedStep = {
              stepIndex: completedStepIndex,
              data: stepData,
              verifiedAt: new Date().toLocaleTimeString(),
            };
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = entry;
              return updated;
            }
            return [...prev, entry];
          });
        }
        setCurrentStep(data.currentStep);
        setInstruction(data.nextInstruction);
        setAnalysis(null);
        break;
      }

      case "audio":
        setInstruction(data.text);
        setAudioData(data.audioData);
        break;

      case "instruction":
        setInstruction(data.text);
        break;

      case "completed": {
        // Save final step data before completing
        const finalData = analysis?.extractedData?.filter((d: ExtractedDataItem) => d.label && d.value) || [];
        if (finalData.length > 0) {
          setVerifiedSteps((prev) => {
            const entry: VerifiedStep = {
              stepIndex: currentStep,
              data: finalData,
              verifiedAt: new Date().toLocaleTimeString(),
            };
            return [...prev.filter((v) => v.stepIndex !== currentStep), entry];
          });
        }
        setStatus("completed");
        stopScreenShare();
        break;
      }

      case "error":
        setError(data.message);
        setStatus("error");
        break;

      case "pong":
        break;
    }
  };

  // Start screen sharing
  const startScreenShare = async () => {
    setStatus("connecting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          frameRate: { ideal: 5, max: 10 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopScreenShare();
      });

      connectWebSocket();
      startFrameSampling();
      setStatus("active");
    } catch (err: any) {
      console.error("Failed to start screen share:", err);
      if (err.name === "NotAllowedError") {
        setError("Screen sharing permission was denied. Please try again.");
      } else {
        setError("Failed to start screen sharing. Please try again.");
      }
      setStatus("error");
    }
  };

  // Stop screen sharing
  const stopScreenShare = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (status !== "completed") {
      setStatus("idle");
    }
  };

  // Sample frames and send to server
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

      const imageData = canvas.toDataURL("image/jpeg", 0.7);
      wsRef.current.send(JSON.stringify({ type: "frame", imageData }));
    }, 2000);
  };

  const requestHint = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "requestHint" }));
    }
  };

  useEffect(() => { return () => { stopScreenShare(); }; }, []);

  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
    return () => clearInterval(heartbeat);
  }, []);

  // All verified data flattened for the completion screen
  const allVerifiedData = verifiedSteps.flatMap((v) => v.data);

  // Step labels for display
  const stepLabels = ["Handle Verification", "Analytics Verification"];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold">{template.name}</h1>
          <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full">
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Idle State */}
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="max-w-md text-center">
              <div className="w-24 h-24 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-4">Ready to Verify?</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                We'll verify your Instagram account in {totalSteps} steps with AI-powered screen analysis. Share your screen to begin.
              </p>
              <button onClick={startScreenShare} className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg text-lg transition-colors">
                Share Screen & Start
              </button>
            </div>
          </div>
        )}

        {/* Active State */}
        {(status === "active" || status === "ready" || status === "connecting") && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Video Preview */}
            <div className="lg:col-span-2">
              <div className="bg-black rounded-lg overflow-hidden aspect-video relative">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                {status === "connecting" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="text-center text-white">
                      <div className="spinner mx-auto mb-2"></div>
                      <p>Connecting...</p>
                    </div>
                  </div>
                )}
                {isAnalyzing && (
                  <div className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    Analyzing...
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Verification Checklist */}
              <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Verification Progress</h3>
                <div className="space-y-3">
                  {steps.map((_, i) => {
                    const verified = verifiedSteps.find((v) => v.stepIndex === i);
                    const isCurrent = i === currentStep;
                    return (
                      <div key={i} className={cn(
                        "flex items-start gap-3 p-3 rounded-lg transition-colors",
                        verified ? "bg-green-50 dark:bg-green-900/20" : isCurrent ? "bg-blue-50 dark:bg-blue-900/20" : "bg-gray-50 dark:bg-gray-800"
                      )}>
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                          verified ? "bg-green-500" : isCurrent ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
                        )}>
                          {verified ? (
                            <CheckIcon className="w-4 h-4 text-white" />
                          ) : (
                            <span className="text-xs font-bold text-white">{i + 1}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm font-medium",
                            verified ? "text-green-700 dark:text-green-400" : isCurrent ? "text-blue-700 dark:text-blue-400" : "text-gray-500"
                          )}>
                            {stepLabels[i] || `Step ${i + 1}`}
                          </p>
                          {/* Show verified data inline */}
                          {verified && verified.data.map((d, j) => (
                            <div key={j} className="flex items-center gap-2 mt-1">
                              <CheckIcon className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              <span className="text-xs text-gray-500 dark:text-gray-400">{d.label}:</span>
                              <span className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{d.value}</span>
                            </div>
                          ))}
                          {/* Show current step description */}
                          {isCurrent && !verified && (
                            <p className="text-xs text-gray-500 mt-1">In progress...</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Current Instruction */}
              <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-sm">
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  Step {currentStep + 1} of {totalSteps}
                </h3>
                <p className="text-base font-medium">
                  {instruction || steps[currentStep]?.instruction || "Loading..."}
                </p>
              </div>

              {/* Audio Player */}
              {audioData && (
                <AudioPlayer audioData={audioData} onComplete={() => setAudioData(null)} />
              )}

              {/* Analysis Status */}
              {analysis && (
                <div className={cn(
                  "rounded-lg p-4",
                  analysis.matchesSuccess
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    : "bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
                )}>
                  <p className="text-sm">{analysis.description}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Confidence: {Math.round(analysis.confidence * 100)}%
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button onClick={requestHint} className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors">
                  Get Hint
                </button>
                <button onClick={stopScreenShare} className="flex-1 px-4 py-2 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium transition-colors">
                  Stop Session
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Completed State */}
        {status === "completed" && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="max-w-lg w-full">
              {/* Success header */}
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckIcon className="w-10 h-10 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Verification Complete</h2>
                <p className="text-gray-500 dark:text-gray-400">
                  All data has been verified from your live screen.
                </p>
              </div>

              {/* Verified Data Card */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-3">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Verified Instagram Data
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  {verifiedSteps.map((vs, i) => (
                    <div key={i}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        {stepLabels[vs.stepIndex] || `Step ${vs.stepIndex + 1}`}
                      </p>
                      {vs.data.map((d, j) => (
                        <div key={j} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                          <div className="flex items-center gap-2">
                            <CheckIcon className="w-4 h-4 text-green-500" />
                            <span className="text-sm text-gray-600 dark:text-gray-400">{d.label}</span>
                          </div>
                          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {allVerifiedData.length === 0 && (
                    <p className="text-gray-500 text-center py-4">Session completed.</p>
                  )}
                </div>
                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-400 text-center">
                    Verified via live screen analysis • {new Date().toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Back button */}
              <div className="text-center mt-6">
                <a href="/" className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors inline-block">
                  Back to Home
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
