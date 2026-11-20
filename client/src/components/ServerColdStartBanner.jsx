import React, { useEffect, useState, useRef } from "react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

/**
 * ServerColdStartBanner:
 * Detects Render free-tier cold starts on application load and pings every 10 minutes
 * to keep the signaling server awake during active browser sessions.
 */
export default function ServerColdStartBanner() {
  const [isWaking, setIsWaking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    let slowWakeupTimeout = null;

    const checkServerHealth = async () => {
      // If server does not reply within 2.5s, it is likely cold starting on Render
      slowWakeupTimeout = setTimeout(() => {
        if (isMounted && !isReady) {
          setIsWaking(true);
          timerRef.current = setInterval(() => {
            setElapsedSeconds((sec) => sec + 1);
          }, 1000);
        }
      }, 2500);

      try {
        const response = await fetch(`${SERVER_URL}/health`);
        if (response.ok && isMounted) {
          clearTimeout(slowWakeupTimeout);
          clearInterval(timerRef.current);
          setIsWaking(false);
          setIsReady(true);
        }
      } catch (err) {
        // Retry probe in 4 seconds if failed
        if (isMounted) {
          setTimeout(checkServerHealth, 4000);
        }
      }
    };

    checkServerHealth();

    // Keep-alive ping every 10 minutes to prevent Render free-tier spindown
    const keepAliveInterval = setInterval(async () => {
      try {
        await fetch(`${SERVER_URL}/health`);
      } catch (e) {}
    }, 10 * 60 * 1000);

    return () => {
      isMounted = false;
      clearTimeout(slowWakeupTimeout);
      clearInterval(timerRef.current);
      clearInterval(keepAliveInterval);
    };
  }, []);

  if (!isWaking) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-slate-900 border border-amber-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-lg flex-shrink-0 animate-pulse">
          ⚡
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white tracking-wide">
              Waking Up Signaling Server
            </h4>
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
              {elapsedSeconds}s
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Render's free tier spins down after inactivity. Waking the server usually takes ~30–45 seconds. WebRTC calls will connect shortly.
          </p>
        </div>
      </div>
    </div>
  );
}
