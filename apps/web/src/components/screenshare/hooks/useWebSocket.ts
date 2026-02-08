import { useRef, useCallback, useEffect } from "react";

interface UseWebSocketOptions {
  token: string;
  onMessage: (data: any) => void;
  onConnected: () => void;
  onError: (msg: string) => void;
}

export function useWebSocket({ token, onMessage, onConnected, onError }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  const connectWebSocket = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws/${token}`);
    ws.onopen = () => {
      onConnected();
    };
    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (err) {
        console.error("[WS] Parse error:", err);
      }
    };
    ws.onerror = () => {
      onError("Connection error. Please refresh the page.");
    };
    ws.onclose = () => {
      // Only auto-reconnect if we're still actively in a session
      // wsRef.current is set to null by disconnect(), so check that too
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          connectWebSocket();
        }
      }, 3000);
    };
    wsRef.current = ws;
  }, [token, onMessage, onConnected, onError]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Heartbeat ping every 30s
  useEffect(() => {
    const hb = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
    return () => clearInterval(hb);
  }, []);

  return { wsRef, connect: connectWebSocket, disconnect, send };
}
