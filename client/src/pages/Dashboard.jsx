import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

const ITEMS_PER_PAGE = 6;

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // Call generation and joining states
  const [joinCode, setJoinCode] = useState("");

  // History, Search, and Filtering states
  const [calls, setCalls] = useState([]);
  const [allCallsForStats, setAllCallsForStats] = useState([]);
  const [profilesMap, setProfilesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("all"); // "all", "positive", "neutral", "negative"
  const [currentPage, setCurrentPage] = useState(1);

  const displayName =
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "Caller";

  useEffect(() => {
    document.title = "Dashboard | CallMind VoIP";
  }, []);

  /**
   * 1. Fetch all calls for the user to compute top stats
   */
  useEffect(() => {
    if (!user?.id) return;

    const fetchAllForStats = async () => {
      setStatsLoading(true);
      try {
        const { data, error } = await supabase
          .from("calls")
          .select(`
            id,
            duration_seconds,
            avg_jitter_ms,
            avg_packet_loss,
            avg_rtt_ms,
            call_summaries (
              summary,
              sentiment,
              topics
            )
          `)
          .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
          .order("created_at", { ascending: false });

        if (!error && data) {
          setAllCallsForStats(data);
        }
      } catch (err) {
        console.warn("[Dashboard] Error loading stats:", err);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchAllForStats();
  }, [user]);

  /**
   * 2. Fetch paginated calls with search and sentiment filtering
   */
  useEffect(() => {
    if (!user?.id) return;

    const fetchCalls = async () => {
      setLoading(true);
      try {
        let matchingCallIds = null;
        const cleanQuery = searchQuery.trim();

        // If searching: filter by transcript text AND summary text using Supabase ilike
        if (cleanQuery) {
          // A. Search summaries matching text
          const { data: summaryMatches } = await supabase
            .from("call_summaries")
            .select("call_id")
            .ilike("summary", `%${cleanQuery}%`);

          // B. Search transcript lines matching text
          const { data: transcriptMatches } = await supabase
            .from("transcript_lines")
            .select("call_id")
            .ilike("text", `%${cleanQuery}%`);

          const ids = new Set([
            ...(summaryMatches || []).map((s) => s.call_id),
            ...(transcriptMatches || []).map((t) => t.call_id),
          ]);

          matchingCallIds = Array.from(ids);

          // If no matching calls found for query, empty list immediately
          if (matchingCallIds.length === 0) {
            setCalls([]);
            setLoading(false);
            return;
          }
        }

        // Build main calls query
        let query = supabase
          .from("calls")
          .select(`
            *,
            call_summaries (
              summary,
              sentiment,
              topics,
              action_items
            )
          `)
          .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
          .order("created_at", { ascending: false });

        if (matchingCallIds && matchingCallIds.length > 0) {
          query = query.in("id", matchingCallIds);
        }

        const { data: callsData, error: callsError } = await query;

        if (callsError) {
          console.warn("[Dashboard] Error fetching calls:", callsError);
          setCalls([]);
          setLoading(false);
          return;
        }

        let results = callsData || [];

        // Apply sentiment filter if not "all"
        if (sentimentFilter !== "all") {
          results = results.filter((c) => {
            const summaryObj = Array.isArray(c.call_summaries)
              ? c.call_summaries[0]
              : c.call_summaries;
            return (
              summaryObj?.sentiment?.toLowerCase() ===
              sentimentFilter.toLowerCase()
            );
          });
        }

        setCalls(results);

        // Fetch participant names from `profiles`
        const userIds = new Set();
        results.forEach((c) => {
          if (c.host_id) userIds.add(c.host_id);
          if (c.guest_id) userIds.add(c.guest_id);
        });

        if (userIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", Array.from(userIds));

          if (profiles) {
            const map = {};
            profiles.forEach((p) => {
              map[p.id] = p.full_name || p.email?.split("@")[0] || "User";
            });
            setProfilesMap(map);
          }
        }
      } catch (err) {
        console.error("[Dashboard] Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchCalls();
  }, [user, searchQuery, sentimentFilter]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sentimentFilter]);

  /**
   * 3. Compute Top Stats: Total calls, Total minutes, Average MOS quality, Most common topics
   */
  const stats = useMemo(() => {
    const totalCalls = allCallsForStats.length;
    const totalSeconds = allCallsForStats.reduce(
      (sum, c) => sum + (c.duration_seconds || 0),
      0
    );
    const totalMinutes = Math.round(totalSeconds / 60);

    // Compute Average VoIP Quality (MOS) using standard ITU-T E-model
    const callsWithQos = allCallsForStats.filter(
      (c) => (c.avg_rtt_ms || 0) > 0 || (c.avg_jitter_ms || 0) > 0
    );

    let avgMos = 4.5;
    if (callsWithQos.length > 0) {
      const avgRtt =
        callsWithQos.reduce((acc, c) => acc + (c.avg_rtt_ms || 0), 0) /
        callsWithQos.length;
      const avgJitter =
        callsWithQos.reduce((acc, c) => acc + (c.avg_jitter_ms || 0), 0) /
        callsWithQos.length;
      const avgLoss =
        callsWithQos.reduce((acc, c) => acc + (c.avg_packet_loss || 0), 0) /
        callsWithQos.length;

      const effectiveLatency = avgRtt / 2 + avgJitter * 2;
      let R = 94.0;
      if (effectiveLatency > 160) {
        R -= (effectiveLatency - 160) / 40;
      } else if (effectiveLatency > 0) {
        R -= effectiveLatency * 0.02;
      }
      R -= avgLoss * 2.5;
      R = Math.max(0, Math.min(100, R));

      let mos = 1.0;
      if (R > 0) {
        mos = 1 + 0.035 * R + R * (100 - R) * (R - 60) * 0.000007;
      }
      avgMos = Math.max(1.0, Math.min(5.0, Number(mos.toFixed(1))));
    }

    // Most common topics extraction
    const topicFrequency = {};
    allCallsForStats.forEach((c) => {
      const summaryObj = Array.isArray(c.call_summaries)
        ? c.call_summaries[0]
        : c.call_summaries;
      if (Array.isArray(summaryObj?.topics)) {
        summaryObj.topics.forEach((t) => {
          const clean = t.trim();
          if (clean && clean.toLowerCase() !== "no speech recorded") {
            topicFrequency[clean] = (topicFrequency[clean] || 0) + 1;
          }
        });
      }
    });

    const topTopics = Object.entries(topicFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([topic, count]) => ({ topic, count }));

    return {
      totalCalls,
      totalMinutes,
      avgMos,
      topTopics,
    };
  }, [allCallsForStats]);

  // Paginated Slicing
  const totalPages = Math.max(1, Math.ceil(calls.length / ITEMS_PER_PAGE));
  const paginatedCalls = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return calls.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [calls, currentPage]);

  const generateRoomCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleStartCall = () => {
    const roomCode = generateRoomCode();
    navigate(`/call/${roomCode}`);
  };

  const handleJoinCall = (e) => {
    e.preventDefault();
    const clean = joinCode.trim().toUpperCase();
    if (!clean) {
      alert("Please enter a valid room code.");
      return;
    }
    navigate(`/call/${clean}`);
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/login");
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const getSentimentBadge = (sentiment) => {
    switch (sentiment?.toLowerCase()) {
      case "positive":
        return {
          label: "Positive",
          className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        };
      case "negative":
        return {
          label: "Negative",
          className: "bg-rose-500/15 text-rose-300 border-rose-500/30",
        };
      default:
        return {
          label: "Neutral",
          className: "bg-blue-500/15 text-blue-300 border-blue-500/30",
        };
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-black text-white text-lg shadow-md shadow-blue-500/20">
              C
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-white">CallMind</span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                VoIP Platform
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/ask"
              className="px-3.5 py-1.5 rounded-xl border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30 text-xs font-semibold text-blue-300 transition flex items-center gap-1.5 shadow-sm active:scale-[0.98]"
              title="Ask AI questions across all your calls"
            >
              <span>🤖</span>
              <span>Ask Calls</span>
            </Link>

            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-200">{displayName}</p>
              <p className="text-xs text-slate-400 font-mono">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700/80 text-xs font-medium text-slate-300 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Welcome Hero */}
        <div className="space-y-1">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Welcome back, <span className="text-blue-400">{displayName}</span>
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm">
            AI Call Intelligence &amp; Native WebRTC VoIP Dashboard
          </p>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Stat 1: Total Calls */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold uppercase tracking-wider">Total Calls</span>
              <span className="text-base">📞</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-white">
              {statsLoading ? "—" : stats.totalCalls}
            </div>
            <span className="text-[10px] text-slate-500 block mt-1">Recorded sessions</span>
          </div>

          {/* Stat 2: Total Minutes */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold uppercase tracking-wider">Talk Time</span>
              <span className="text-base">⏱️</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-blue-400">
              {statsLoading ? "—" : `${stats.totalMinutes}m`}
            </div>
            <span className="text-[10px] text-slate-500 block mt-1">Cumulative duration</span>
          </div>

          {/* Stat 3: Average MOS Call Quality */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold uppercase tracking-wider">Avg Quality</span>
              <span className="text-base">📶</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">
              {statsLoading ? "—" : `${stats.avgMos} / 5.0`}
            </div>
            <span className="text-[10px] text-slate-500 block mt-1">
              {stats.avgMos >= 4.0 ? "Excellent" : stats.avgMos >= 3.6 ? "Good" : "Fair"} (ITU-T E-model)
            </span>
          </div>

          {/* Stat 4: Most Common Topics */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-semibold uppercase tracking-wider">Key Topics</span>
              <span className="text-base">🏷️</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 overflow-hidden">
              {stats.topTopics.length > 0 ? (
                stats.topTopics.map((item, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] font-medium"
                  >
                    #{item.topic} ({item.count})
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-slate-500 italic">No topics yet</span>
              )}
            </div>
            <span className="text-[10px] text-slate-500 block mt-1">From Gemini AI analysis</span>
          </div>
        </div>

        {/* Action Cards: Start Call & Join Call */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Card 1: Start a Call */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between hover:border-slate-700 transition">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-lg font-bold">
                📞
              </div>
              <h3 className="text-base font-bold text-white">Start an Instant Call</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Generate a unique 6-character room code, initialize native WebRTC audio, and share the code with a peer.
              </p>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <button
                onClick={handleStartCall}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-600/25 transition active:scale-[0.98] text-xs flex items-center justify-center gap-2"
              >
                <span>Start a Call</span>
              </button>
            </div>
          </div>

          {/* Card 2: Join a Call */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between hover:border-slate-700 transition">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-lg font-bold">
                🔗
              </div>
              <h3 className="text-base font-bold text-white">Join an Existing Call</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Have an invitation code from a peer? Enter the 6-character room code below to connect.
              </p>
            </div>

            <form onSubmit={handleJoinCall} className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={12}
                  placeholder="e.g. 7K2M9X"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono uppercase tracking-wider transition"
                />
                <button
                  type="submit"
                  className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] text-xs"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* "Ask Your Calls" Quick Intelligence Banner */}
        <div className="bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-purple-950/40 border border-blue-500/25 rounded-3xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-2xl shadow-inner shrink-0">
              🤖
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Ask Your Calls AI Chat
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-semibold">
                  New
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-xl">
                Have a question like <em>"What action items are pending?"</em> or{" "}
                <em>"Who said what about the deadline?"</em> Ask Gemini to query your recent call memory.
              </p>
            </div>
          </div>

          <Link
            to="/ask"
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/25 transition active:scale-[0.98] flex items-center gap-2 shrink-0"
          >
            <span>Open Ask Calls</span>
            <span>→</span>
          </Link>
        </div>

        {/* Call History Section with Search, Filter & Pagination */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          {/* Header & Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                Call History &amp; Intelligence Archive
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Search transcripts, filter by sentiment, and review post-call AI summaries.
              </p>
            </div>

            {/* Total Results Count */}
            <span className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 w-fit">
              {calls.length} Call{calls.length === 1 ? "" : "s"} Found
            </span>
          </div>

          {/* Search Box & Sentiment Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            {/* Search Input */}
            <div className="sm:col-span-8 relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-500 text-xs">
                🔍
              </span>
              <input
                type="text"
                placeholder="Search across transcript lines and AI summaries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
            </div>

            {/* Sentiment Selector */}
            <div className="sm:col-span-4">
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              >
                <option value="all">All Sentiments</option>
                <option value="positive">😊 Positive Sentiment</option>
                <option value="neutral">😐 Neutral Sentiment</option>
                <option value="negative">😟 Negative Sentiment</option>
              </select>
            </div>
          </div>

          {/* Loading Skeletons */}
          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 space-y-3 animate-pulse"
                >
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-slate-800 rounded w-1/3"></div>
                    <div className="h-4 bg-slate-800 rounded w-1/4"></div>
                  </div>
                  <div className="h-3 bg-slate-800/60 rounded w-2/3"></div>
                  <div className="h-10 bg-slate-900 rounded"></div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State: No calls match query */}
          {!loading && calls.length === 0 && (
            <div className="py-16 text-center text-slate-500 space-y-3">
              <span className="text-3xl block">🔍</span>
              <p className="text-sm font-semibold text-slate-300">
                {searchQuery || sentimentFilter !== "all"
                  ? "No calls match your search or filter criteria."
                  : "No recorded calls yet."}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {searchQuery || sentimentFilter !== "all"
                  ? "Try searching for a different keyword or reset the sentiment filter."
                  : "Start an instant call above. Transcripts and AI briefings will populate here."}
              </p>
              {(searchQuery || sentimentFilter !== "all") && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setSentimentFilter("all");
                  }}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-medium transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}

          {/* Call Cards Grid */}
          {!loading && paginatedCalls.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {paginatedCalls.map((c) => {
                const summaryObj = Array.isArray(c.call_summaries)
                  ? c.call_summaries[0]
                  : c.call_summaries;

                const firstSummaryLine = summaryObj?.summary
                  ? summaryObj.summary.split("\n")[0]
                  : "Summary pending generation...";

                const sentiment = summaryObj?.sentiment;
                const sentimentBadge = getSentimentBadge(sentiment);

                const dateStr = new Date(c.created_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                const isHost = c.host_id === user?.id;
                const hostName = profilesMap[c.host_id] || (isHost ? "You" : "Host");
                const guestName = c.guest_id
                  ? profilesMap[c.guest_id] || (c.guest_id === user?.id ? "You" : "Guest")
                  : "Solo / Disconnected";

                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/summary/${c.id}`)}
                    className="bg-slate-950/60 hover:bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/40 rounded-2xl p-5 shadow-lg transition cursor-pointer flex flex-col justify-between group space-y-3"
                  >
                    {/* Card Top: Date, Room & Sentiment */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-white group-hover:text-blue-400 transition">
                            Room: {c.room_code}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                              isHost
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            }`}
                          >
                            {isHost ? "Host" : "Guest"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                          {dateStr}
                        </p>
                      </div>

                      {/* Sentiment Badge */}
                      {sentiment && (
                        <span
                          className={`text-[10px] px-2.5 py-1 rounded-full border font-bold uppercase tracking-wider ${sentimentBadge.className}`}
                        >
                          {sentimentBadge.label}
                        </span>
                      )}
                    </div>

                    {/* Participants & Duration */}
                    <div className="flex items-center justify-between text-xs text-slate-400 py-1 border-y border-slate-800/60">
                      <span className="truncate max-w-[200px]">
                        👤 {hostName} &amp; {guestName}
                      </span>
                      <span className="font-mono text-slate-300">
                        ⏱️ {formatDuration(c.duration_seconds)}
                      </span>
                    </div>

                    {/* First line of AI Summary */}
                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {firstSummaryLine}
                    </p>

                    {/* Footer: View Summary indicator */}
                    <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500 group-hover:text-blue-400 transition">
                      <span>View Intelligence Briefing</span>
                      <span>→</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {!loading && totalPages > 1 && (
            <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3.5 py-1.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed font-medium transition"
              >
                ← Previous
              </button>

              <span className="font-mono">
                Page {currentPage} of {totalPages}
              </span>

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3.5 py-1.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed font-medium transition"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
