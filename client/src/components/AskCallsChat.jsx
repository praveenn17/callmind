import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

const GLOBAL_SUGGESTIONS = [
  "What action items are pending?",
  "Summarize last week's calls",
  "Who said what about the deadline?",
  "Which call discussed key deliverables?",
];

const SCOPED_SUGGESTIONS = [
  "What action items were agreed upon in this call?",
  "Summarize this discussion briefly",
  "What were the key topics discussed?",
  "What was the overall sentiment and tone?",
];

export default function AskCallsChat({ callId = null, isPanel = false }) {
  // Chat history maintained in component state only
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const suggestions = callId ? SCOPED_SUGGESTIONS : GLOBAL_SUGGESTIONS;

  // Auto-scroll chat window when new message arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (questionToSend) => {
    const query = (questionToSend || input || "").trim();
    if (!query || loading) return;

    setError(null);
    setInput("");

    // 1. Add user message to state
    const userMsg = {
      id: "u-" + Date.now(),
      sender: "user",
      text: query,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      // 2. Obtain current user's session token
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("You must be signed in to query call intelligence.");
      }

      // 3. Request answer from server
      const response = await fetch(`${SERVER_URL}/api/ask-calls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          question: query,
          callId: callId || undefined,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned error (${response.status})`);
      }

      const result = await response.json();

      // 4. Add assistant response to state
      const assistantMsg = {
        id: "a-" + Date.now(),
        sender: "assistant",
        text: result.answer || "I couldn't find that in your calls.",
        sources: Array.isArray(result.sources) ? result.sources : [],
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error("[AskCallsChat Error]", err);
      setError(err.message || "Failed to retrieve answer.");
      const errorMsg = {
        id: "err-" + Date.now(),
        sender: "assistant",
        text: "Sorry, I encountered an issue querying your calls: " + (err.message || "Unknown error"),
        sources: [],
        isError: true,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div
      className={`flex flex-col bg-slate-900/90 border border-slate-800 rounded-3xl shadow-xl backdrop-blur overflow-hidden ${
        isPanel ? "h-[560px]" : "h-[700px] max-w-4xl mx-auto w-full"
      }`}
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-sm shadow-sm">
            🤖
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <span>Ask Your Calls</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-normal">
                {callId ? "This Call Only" : "Across 15 Calls"}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {callId
                ? "Inquire about topics, decisions, and transcripts in this session"
                : "Ask questions across your recent calls, deadlines, and action items"}
            </p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="text-[11px] px-2.5 py-1 rounded-lg text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition"
            title="Clear chat history"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-2xl text-blue-400 shadow-inner">
              💬
            </div>
            <div className="max-w-md space-y-1">
              <h4 className="text-base font-bold text-white">
                {callId ? "Ask anything about this call" : "Ask anything about your past calls"}
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Gemini analyzes recorded transcripts and summaries to provide factual answers
                with exact call citations.
              </p>
            </div>

            {/* Suggested Question Chips */}
            <div className="w-full max-w-lg pt-2">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                Suggested questions
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(suggestion)}
                    className="text-xs text-left px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-800/60 text-slate-300 hover:text-white transition shadow-sm active:scale-[0.98]"
                  >
                    💡 {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.sender === "user";
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1.5`}
            >
              <div className="flex items-center gap-2 text-[10px] text-slate-500 px-1 font-mono">
                <span>{isUser ? "You" : "CallMind AI"}</span>
                <span>•</span>
                <span>{msg.timestamp}</span>
              </div>

              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-md ${
                  isUser
                    ? "bg-blue-600 text-white rounded-br-none"
                    : msg.isError
                    ? "bg-rose-950/40 border border-rose-800/50 text-rose-200 rounded-bl-none"
                    : "bg-slate-950 border border-slate-800 text-slate-200 rounded-bl-none"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* Clickable Source Citations */}
                {!isUser && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Cited Sources ({msg.sources.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.sources.map((src, i) => (
                        <Link
                          key={i}
                          to={`/summary/${src.callId}`}
                          className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/25 transition group font-medium"
                          title="Open Call Intelligence Summary"
                        >
                          <span>📄</span>
                          <span>Call ({src.date || "Session"})</span>
                          <span className="text-blue-400 group-hover:translate-x-0.5 transition-transform text-[10px]">
                            →
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-xs">
              🤖
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2 text-xs text-slate-400 shadow-md">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
              <span>Searching transcripts &amp; analyzing with Gemini...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Chips Bar (When messages exist) */}
      {messages.length > 0 && !loading && (
        <div className="px-4 py-2 border-t border-slate-800/50 bg-slate-950/30 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[10px] text-slate-500 uppercase font-semibold shrink-0">
            Suggested:
          </span>
          {suggestions.slice(0, 3).map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(s)}
              className="text-[11px] shrink-0 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 transition"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input Form */}
      <div className="p-3 sm:p-4 border-t border-slate-800/80 bg-slate-950/60">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder={
              callId
                ? "Ask a question about this call session..."
                : "Ask anything about your recent calls..."
            }
            className="flex-1 bg-slate-950 border border-slate-700/80 hover:border-slate-600 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white disabled:text-slate-500 font-semibold text-xs shadow-md shadow-blue-600/20 transition flex items-center gap-1.5 active:scale-[0.98] disabled:cursor-not-allowed"
          >
            <span>Ask</span>
            <span>↵</span>
          </button>
        </form>
      </div>
    </div>
  );
}
