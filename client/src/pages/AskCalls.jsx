import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AskCallsChat from "../components/AskCallsChat";

export default function AskCalls() {
  const { user, signOut } = useAuth();

  useEffect(() => {
    document.title = "Ask Your Calls | CallMind Intelligence";
  }, []);

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="text-slate-400 hover:text-slate-200 transition text-sm flex items-center gap-1.5"
            >
              <span>←</span>
              <span>Dashboard</span>
            </Link>
            <span className="text-slate-700">|</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">
                <span className="text-blue-500">CallMind</span> Intelligence
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-semibold">
                Ask Calls
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-slate-200">{displayName}</p>
              <p className="text-[11px] text-slate-400 font-mono">{user?.email}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="px-3 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700/80 text-xs font-medium text-slate-300 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col space-y-6">
        {/* Title & Description */}
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-1">
            <span>✨</span>
            <span>Natural Language VoIP Memory</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Ask Your Recorded Calls
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
            Query across your most recent 15 VoIP call recordings, action items, deadlines,
            and executive summaries. Every answer is grounded directly in your conversational data.
          </p>
        </div>

        {/* Reusable Chat Engine */}
        <div className="flex-1 flex flex-col">
          <AskCallsChat isPanel={false} />
        </div>
      </main>
    </div>
  );
}
