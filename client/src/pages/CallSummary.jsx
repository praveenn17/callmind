import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import AskCallsChat from "../components/AskCallsChat";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

// Language allowlist — must mirror the server-side list exactly.
const SUPPORTED_SUMMARY_LANGUAGES = [
  { code: "English",  label: "English" },
  { code: "Hindi",    label: "हिन्दी (Hindi)" },
  { code: "Hinglish", label: "Hinglish" },
  { code: "Spanish",  label: "Español (Spanish)" },
  { code: "French",   label: "Français (French)" },
  { code: "German",   label: "Deutsch (German)" },
  { code: "Tamil",    label: "தமிழ் (Tamil)" },
  { code: "Bengali",  label: "বাংলা (Bengali)" },
  { code: "Marathi",  label: "मराठी (Marathi)" },
  { code: "Gujarati", label: "ગુજરાતી (Gujarati)" },
];

// Persist last-chosen language across sessions
const LS_LANG_KEY = "callmind_summary_language";
const getDefaultLanguage = () => localStorage.getItem(LS_LANG_KEY) || "English";

export default function CallSummary() {
  const { callId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  // Track whether a language-switch re-analysis is in progress (keeps existing
  // summary visible while the spinner overlays the summary section only).
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [callMeta, setCallMeta] = useState(null);
  const [transcriptLines, setTranscriptLines] = useState([]);
  const [checkedActions, setCheckedActions] = useState({});
  const [selectedLanguage, setSelectedLanguage] = useState(getDefaultLanguage);

  // PDF export state
  const [exporting, setExporting] = useState(false);
  const pdfRef = useRef(null);

  // Scoped "Ask About This Call" collapsible panel state
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    document.title = "Call Intelligence Briefing | CallMind";
    if (!callId) {
      navigate("/dashboard");
      return;
    }

    fetchCallIntelligence(selectedLanguage);
  }, [callId]);

  /**
   * Fetch AI analysis for the given language.
   * - On first load: full page loading spinner.
   * - On language switch: smaller "re-analyzing" overlay so the previous
   *   summary stays visible and content doesn't flash away.
   */
  const fetchCallIntelligence = async (language, isSwitch = false) => {
    if (isSwitch) {
      setReanalyzing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Get current Supabase session token
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("You must be logged in to view call intelligence.");
      }

      // 2. Fetch Call metadata from Supabase (only needed on first load)
      if (!isSwitch) {
        const { data: callRow, error: callErr } = await supabase
          .from("calls")
          .select("*")
          .eq("id", callId)
          .single();

        if (callErr) {
          console.warn("[Supabase] Failed to fetch call metadata:", callErr);
        } else {
          setCallMeta(callRow);
        }

        // 3. Fetch full transcript lines from Supabase
        const { data: lines, error: linesErr } = await supabase
          .from("transcript_lines")
          .select("*")
          .eq("call_id", callId)
          .order("created_at", { ascending: true });

        if (linesErr) {
          console.warn("[Supabase] Failed to fetch transcript lines:", linesErr);
        } else {
          setTranscriptLines(lines || []);
        }
      }

      // 4. Request AI Analysis from Server (Gemini Flash)
      //    Pass the requested language so the server can cache-match or regenerate.
      const response = await fetch(`${SERVER_URL}/api/analyze-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ callId, language }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(
          errorJson.error || `Server responded with status ${response.status}`
        );
      }

      const data = await response.json();
      setSummaryData(data);
      // Reset action-item checkboxes when language changes (items have new text)
      if (isSwitch) setCheckedActions({});
    } catch (err) {
      console.error("[CallSummary] Error loading call intelligence:", err);
      setError(err.message || "Failed to load call intelligence.");
    } finally {
      setLoading(false);
      setReanalyzing(false);
    }
  };

  /** Called when the user picks a different language from the dropdown. */
  const handleLanguageChange = (e) => {
    const lang = e.target.value;
    setSelectedLanguage(lang);
    localStorage.setItem(LS_LANG_KEY, lang);
    fetchCallIntelligence(lang, true);
  };

  /**
   * Export PDF — dynamically imports html2pdf.js, populates a hidden
   * light-themed div, then renders it via html2canvas and jsPDF.
   * html2canvas rasterises the DOM so Devanagari / Unicode glyphs always
   * appear correctly regardless of PDF font embedding.
   */
  const exportPDF = async () => {
    if (!summaryData || exporting) return;
    setExporting(true);

    try {
      // Dynamic import — avoids bundling the heavy library unless needed
      const html2pdf = (await import("html2pdf.js")).default;

      // Build filename: callmind-YYYY-MM-DD.pdf
      const dateStr = callMeta?.created_at
        ? new Date(callMeta.created_at).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const filename = `callmind-${dateStr}.pdf`;

      // Map language code -> BCP-47 for <html lang>
      const langAttrMap = {
        Hindi: "hi", Tamil: "ta", Bengali: "bn",
        Marathi: "mr", Gujarati: "gu",
        Spanish: "es", French: "fr", German: "de",
      };
      const langAttr = langAttrMap[selectedLanguage] || "en";

      // Sentiment emoji + label
      const sentimentMap = {
        positive: { icon: "😊", label: "Positive" },
        negative: { icon: "😟", label: "Negative" },
        neutral:  { icon: "😐", label: "Neutral" },
      };
      const sent = sentimentMap[summaryData.sentiment?.toLowerCase()] || sentimentMap.neutral;

      // Format call date + duration
      const callDate = callMeta?.created_at
        ? new Date(callMeta.created_at).toLocaleString()
        : "—";
      const durationSec = callMeta?.duration_seconds ?? null;
      const durationFmt = durationSec != null
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : "—";

      // Calculate Call Quality MOS score using ITU-T E-model
      const rtt = callMeta?.avg_rtt_ms || 0;
      const jitter = callMeta?.avg_jitter_ms || 0;
      const loss = callMeta?.avg_packet_loss || 0;
      const effectiveLatency = rtt / 2 + jitter * 2;
      let R = 94.0;
      if (effectiveLatency > 160) {
        R -= (effectiveLatency - 160) / 40;
      } else if (effectiveLatency > 0) {
        R -= effectiveLatency * 0.02;
      }
      R -= loss * 2.5;
      R = Math.max(0, Math.min(100, R));
      let mosScore = 1.0;
      if (R > 0) {
        mosScore = 1 + 0.035 * R + R * (100 - R) * (R - 60) * 0.000007;
      }
      mosScore = Math.max(1.0, Math.min(5.0, Number(mosScore.toFixed(1))));
      const mosRating =
        mosScore >= 4.0
          ? "Excellent"
          : mosScore >= 3.6
          ? "Good"
          : mosScore >= 3.0
          ? "Fair"
          : "Poor";
      const mosDisplay = `${mosScore} / 5.0 (${mosRating})`;

      // Participants identification
      const isHost = user?.id === callMeta?.host_id;
      const currentUserRole = isHost ? "Host" : "Guest";
      const currentUserName =
        user?.user_metadata?.full_name ||
        user?.email?.split("@")[0] ||
        currentUserRole;
      const otherUserRole = isHost ? "Guest" : "Host";
      const participantsDisplay = callMeta?.guest_id
        ? `${currentUserName} (${currentUserRole}) & ${otherUserRole}`
        : `${currentUserName} (${currentUserRole})`;

      // Build transcript rows HTML — avoids very long strings breaking
      const transcriptHTML = transcriptLines.length
        ? transcriptLines.map((line) => {
            const isCurrent = line.speaker_id === user?.id;
            let speaker;
            if (isCurrent) {
              speaker = `${currentUserName} (${currentUserRole})`;
            } else if (line.speaker_id === callMeta?.host_id) {
              speaker = "Host";
            } else if (line.speaker_id === callMeta?.guest_id) {
              speaker = "Guest";
            } else {
              speaker = "Peer";
            }
            const time = new Date(line.created_at).toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            });
            return `
              <div class="tx-row">
                <div class="tx-meta">
                  <span class="tx-speaker ${isCurrent ? "tx-you" : "tx-peer"}">${speaker}</span>
                  <span class="tx-time">${time}</span>
                </div>
                <p class="tx-text">${line.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
              </div>`;
          }).join("")
        : "<p style='color:#888;font-style:italic'>No transcript lines captured.</p>";

      // Topics chips HTML
      const topicsHTML = (summaryData.topics || []).length
        ? summaryData.topics.map(t =>
            `<span class="chip">#${t.replace(/</g, "&lt;")}</span>`
          ).join("")
        : "<span style='color:#888;font-style:italic'>No topics detected.</span>";

      // Action items HTML
      const actionsHTML = (summaryData.action_items || []).length
        ? summaryData.action_items.map((a, i) =>
            `<div class="action-row">
              <span class="action-num">${i + 1}.</span>
              <span>${a.replace(/</g, "&lt;")}</span>
            </div>`
          ).join("")
        : "<p style='color:#888;font-style:italic'>No action items identified.</p>";

      // ── Full HTML for the hidden print div ──
      // Written as a string so we can inject it into the hidden element safely.
      const html = `
<html lang="${langAttr}">
<head>
<meta charset="UTF-8"/>
<style>
  /* Base */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, 'Nirmala UI', 'Kohinoor Devanagari', 'Noto Sans Devanagari', 'Noto Sans', sans-serif;
    font-size: 11pt;
    color: #1a1a2e;
    background: #fff;
    padding: 0;
  }
  /* Header / branding */
  .pdf-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 3px solid #2563eb;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  .brand-title { font-size: 22pt; font-weight: 800; color: #1e3a8a; letter-spacing: -0.5px; }
  .brand-title span { color: #2563eb; }
  .brand-sub { font-size: 9pt; color: #64748b; margin-top: 2px; }
  .export-date { font-size: 8pt; color: #94a3b8; text-align: right; }

  /* Section headers */
  .section-title {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #2563eb;
    border-bottom: 1.5px solid #dbeafe;
    padding-bottom: 5px;
    margin-bottom: 10px;
    margin-top: 20px;
  }

  /* Call meta grid */
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 4px;
  }
  .meta-card {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
  }
  .meta-label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .meta-value { font-size: 10.5pt; font-weight: 700; color: #0f172a; margin-top: 2px; }

  /* Summary text */
  .summary-text {
    font-size: 10.5pt;
    color: #1e293b;
    line-height: 1.65;
    background: #f8fafc;
    border-left: 3px solid #2563eb;
    padding: 10px 14px;
    border-radius: 4px;
  }

  /* Sentiment badge */
  .sentiment-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    font-weight: 700;
    font-size: 10pt;
  }
  .sentiment-positive { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
  .sentiment-negative { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  .sentiment-neutral  { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }

  /* Topics chips */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    padding: 3px 9px;
    border-radius: 12px;
    font-size: 9pt;
    font-weight: 600;
  }

  /* Action items */
  .action-row {
    display: flex;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #f1f5f9;
    font-size: 10pt;
    color: #1e293b;
  }
  .action-num { font-weight: 700; color: #2563eb; min-width: 18px; }

  /* Transcript */
  .tx-row {
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    margin-bottom: 7px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .tx-meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .tx-speaker {
    font-size: 8pt;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 4px;
  }
  .tx-you  { background: #dbeafe; color: #1d4ed8; }
  .tx-peer { background: #ede9fe; color: #6d28d9; }
  .tx-time { font-size: 7.5pt; color: #94a3b8; font-family: monospace; }
  .tx-text { font-size: 9.5pt; color: #334155; line-height: 1.5; }

  /* Page break helpers */
  .page-break { page-break-before: always; break-before: page; }
  .no-break    { page-break-inside: avoid; break-inside: avoid; }

  /* Language note */
  .lang-badge {
    display: inline-block;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
    font-size: 7.5pt;
    padding: 2px 7px;
    border-radius: 10px;
    margin-top: 6px;
  }
  .footer {
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 7.5pt;
    color: #94a3b8;
    text-align: center;
  }
</style>
</head>
<body>

<!-- ══ HEADER ══ -->
<div class="pdf-header">
  <div>
    <div class="brand-title">Call<span>Mind</span></div>
    <div class="brand-sub">AI Call Intelligence Platform · Post-Call Briefing</div>
  </div>
  <div class="export-date">
    Exported ${new Date().toLocaleString()}<br/>
    Call ID: <span style="font-family:monospace;font-size:7pt">${callId}</span>
  </div>
</div>

<!-- ══ CALL METADATA ══ -->
<div class="section-title">Call Overview &amp; QoS Analytics</div>
<div class="meta-grid no-break">
  <div class="meta-card">
    <div class="meta-label">Date &amp; Time</div>
    <div class="meta-value" style="font-size:9pt">${callDate}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Duration</div>
    <div class="meta-value">${durationFmt}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Participants</div>
    <div class="meta-value" style="font-size:9pt">${participantsDisplay}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Room Code</div>
    <div class="meta-value" style="font-family:monospace">${callMeta?.room_code || "—"}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Quality Score (MOS)</div>
    <div class="meta-value" style="color:#059669">${mosDisplay}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Avg Jitter</div>
    <div class="meta-value">${callMeta?.avg_jitter_ms != null ? Number(callMeta.avg_jitter_ms).toFixed(1) + " ms" : "—"}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Avg Packet Loss</div>
    <div class="meta-value">${callMeta?.avg_packet_loss != null ? Number(callMeta.avg_packet_loss).toFixed(2) + "%" : "—"}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Avg Round-Trip Time</div>
    <div class="meta-value">${callMeta?.avg_rtt_ms != null ? Number(callMeta.avg_rtt_ms).toFixed(1) + " ms" : "—"}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Summary Language</div>
    <div class="meta-value" style="font-size:9pt">${summaryData.language || "English"}</div>
  </div>
</div>

<!-- ══ SENTIMENT ══ -->
<div class="section-title no-break">Call Sentiment</div>
<div class="no-break" style="margin-bottom:8px">
  <span class="sentiment-badge sentiment-${summaryData.sentiment?.toLowerCase() || "neutral"}">
    ${sent.icon} ${sent.label} Sentiment
  </span>
</div>

<!-- ══ EXECUTIVE SUMMARY ══ -->
<div class="section-title no-break">Executive Summary</div>
<div class="no-break">
  <p class="summary-text" lang="${langAttr}" style="unicode-bidi:plaintext">
    ${(summaryData.summary || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
  </p>
  <span class="lang-badge">Language: ${summaryData.language || "English"}</span>
</div>

<!-- ══ KEY TOPICS ══ -->
<div class="section-title no-break">Key Topics &amp; Themes</div>
<div class="chips no-break">${topicsHTML}</div>

<!-- ══ ACTION ITEMS ══ -->
<div class="section-title no-break">Action Items</div>
<div class="no-break">${actionsHTML}</div>

<!-- ══ FULL TRANSCRIPT — starts on a new page for long calls ══ -->
<div class="page-break"></div>
<div class="section-title">Full Call Transcript</div>
<div style="font-size:8pt;color:#64748b;margin-bottom:10px">
  ${transcriptLines.length} line(s) · Speech-to-text captured via WebRTC DataChannel
</div>
<div lang="${langAttr}">${transcriptHTML}</div>

<!-- ══ FOOTER ══ -->
<div class="footer">
  Generated by CallMind AI Intelligence Platform · Powered by Google Gemini Flash ·
  Native WebRTC VoIP &amp; ITU-T QoS Analytics
</div>

</body>
</html>`;

      // Create a hidden iframe-like container off-screen and inject the HTML
      const container = document.createElement("div");
      container.style.cssText = [
        "position:fixed",
        "top:0",
        "left:-9999px",
        "width:794px",   // A4 width at 96dpi
        "background:#fff",
        "z-index:-1",
      ].join(";");
      container.innerHTML = html;
      document.body.appendChild(container);

      await html2pdf()
        .set({
          margin:      [10, 10, 12, 10],  // top, right, bottom, left in mm
          filename,
          image:       { type: "jpeg", quality: 0.97 },
          html2canvas: {
            scale:           2,           // 2x for crisp text
            useCORS:         true,
            letterRendering: true,        // better kerning
            logging:         false,
          },
          jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak:   { mode: ["css", "legacy"], avoid: ".no-break" },
        })
        .from(container)
        .save();

      document.body.removeChild(container);
    } catch (err) {
      console.error("[PDF Export] Error:", err);
      alert("PDF export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  };

  const toggleActionItem = (index) => {
    setCheckedActions((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const getSentimentBadge = (sentiment) => {
    switch (sentiment?.toLowerCase()) {
      case "positive":
        return {
          label: "Positive Sentiment",
          icon: "😊",
          className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
        };
      case "negative":
        return {
          label: "Negative Sentiment",
          icon: "😟",
          className: "bg-rose-500/20 text-rose-300 border-rose-500/40",
        };
      default:
        return {
          label: "Neutral Sentiment",
          icon: "😐",
          className: "bg-blue-500/20 text-blue-300 border-blue-500/40",
        };
    }
  };

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
              <span>Back to Dashboard</span>
            </Link>
            <span className="text-slate-700">|</span>
            <span className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
              <span className="text-blue-500">CallMind</span> AI Intelligence
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800">
              Room: {callMeta?.room_code || "Call"}
            </span>

            {/* Toggle Ask AI Chat button */}
            <button
              onClick={() => setIsChatOpen((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                isChatOpen
                  ? "bg-blue-600/20 text-blue-300 border-blue-500/40"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
              }`}
              title="Toggle AI chat scoped to this call"
            >
              <span>💬</span>
              <span className="hidden sm:inline">Ask Call</span>
            </button>

            {/* Export PDF button — only shown when analysis is complete */}
            {summaryData && !loading && (
              <button
                onClick={exportPDF}
                disabled={exporting}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                  exporting
                    ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-600/20 active:scale-[0.97]"
                }`}
              >
                {exporting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin inline-block"></span>
                    <span>Generating…</span>
                  </>
                ) : (
                  <>
                    <span>⬇</span>
                    <span>Export PDF</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Loading State (initial full-page load) */}
        {loading && (
          <div className="py-20 flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold text-white">
                Generating AI Call Intelligence
              </h2>
              <p className="text-xs text-slate-400 max-w-md">
                Google Gemini Flash is analyzing the call transcript, extracting key topics, sentiment, and action items...
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="max-w-xl mx-auto py-16 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-2xl text-rose-400">
              ⚠️
            </div>
            <h2 className="text-xl font-bold text-white">Analysis Encountered an Error</h2>
            <p className="text-xs text-slate-400">{error}</p>
            <div className="pt-2 flex justify-center gap-3">
              <button
                onClick={() => fetchCallIntelligence(selectedLanguage)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition"
              >
                Retry Analysis
              </button>
              <Link
                to="/dashboard"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Success View */}
        {!loading && !error && summaryData && (
          <div className="space-y-8">
            {/* Call Overview Banner */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-widest block mb-1">
                  Post-Call Analysis Complete
                </span>
                <h1 className="text-2xl font-black text-white tracking-tight">
                  Call Intelligence Briefing
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Call ID: <code className="font-mono text-slate-300">{callId}</code>
                </p>
              </div>

              {/* Call Stats Chips */}
              <div className="flex flex-wrap items-center gap-2">
                {callMeta?.duration_seconds !== undefined && (
                  <span className="text-xs px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-300">
                    ⏱️ {callMeta.duration_seconds}s Duration
                  </span>
                )}
                {callMeta?.avg_rtt_ms !== undefined && (
                  <span className="text-xs px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-300">
                    📶 {callMeta.avg_rtt_ms}ms RTT
                  </span>
                )}
                {callMeta?.avg_jitter_ms !== undefined && (
                  <span className="text-xs px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-300">
                    〰️ {callMeta.avg_jitter_ms}ms Jitter
                  </span>
                )}
              </div>
            </div>

            {/* ── Language Selector + re-analysis overlay ── */}
            <div className="relative">
              {/* Re-analysis loading overlay — shown on top of summary while language switch runs */}
              {reanalyzing && (
                <div className="absolute inset-0 z-10 rounded-3xl bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                  <div className="w-9 h-9 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-blue-300 font-medium">
                    Translating with Gemini Flash…
                  </p>
                </div>
              )}

              {/* AI Executive Summary & Sentiment Card */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Executive Summary */}
                <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">✨</span>
                      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                        Executive Summary
                      </h2>
                    </div>

                    {/* ── Language Dropdown ── */}
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="summary-language"
                        className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap"
                      >
                        🌐 Language
                      </label>
                      <select
                        id="summary-language"
                        value={selectedLanguage}
                        onChange={handleLanguageChange}
                        disabled={reanalyzing}
                        className="px-2.5 py-1.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        {SUPPORTED_SUMMARY_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/*
                    Use lang attribute for correct Unicode shaping and hyphenation
                    of Devanagari (hi), Tamil (ta), Bengali (bn), Gujarati (gu), Marathi (mr).
                    Falls back to "en" for English / Hinglish / Spanish / French / German.
                  */}
                  {(() => {
                    const langAttrMap = {
                      Hindi: "hi", Tamil: "ta", Bengali: "bn",
                      Marathi: "mr", Gujarati: "gu",
                      Spanish: "es", French: "fr", German: "de",
                    };
                    const langAttr = langAttrMap[selectedLanguage] || "en";
                    return (
                      <p
                        lang={langAttr}
                        className="text-sm text-slate-300 leading-relaxed font-normal"
                        style={{ unicodeBidi: "plaintext" }}
                      >
                        {summaryData.summary}
                      </p>
                    );
                  })()}

                  {/* Show saved language badge */}
                  <div className="pt-1 flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono">
                      {summaryData.language || "English"}
                    </span>
                  </div>
                </div>

              {/* Sentiment & Quick Details */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Detected Sentiment
                    </h3>
                    {(() => {
                      const badge = getSentimentBadge(summaryData.sentiment);
                      return (
                        <div
                          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl border text-sm font-bold ${badge.className}`}
                        >
                          <span className="text-lg">{badge.icon}</span>
                          <span>{badge.label}</span>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="pt-4 border-t border-slate-800/80 text-[11px] text-slate-500">
                    Powered by Google Gemini Flash via CallMind Intelligence
                  </div>
                </div>
              </div>
            </div>{/* end relative wrapper */}

            {/* Topics & Action Items Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Key Topics */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800/80">
                  <span className="text-lg">🏷️</span>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                    Key Topics &amp; Themes
                  </h3>
                </div>

                {summaryData.topics?.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {summaryData.topics.map((topic, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/25 text-blue-300 rounded-xl text-xs font-medium"
                      >
                        #{topic}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No distinct topics detected.</p>
                )}
              </div>

              {/* Action Items Checklist */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">✅</span>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                      Action Items
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {Object.values(checkedActions).filter(Boolean).length} /{" "}
                    {summaryData.action_items?.length || 0} done
                  </span>
                </div>

                {summaryData.action_items?.length > 0 ? (
                  <div className="space-y-2.5 pt-1">
                    {summaryData.action_items.map((item, idx) => {
                      const isChecked = !!checkedActions[idx];
                      return (
                        <label
                          key={idx}
                          onClick={() => toggleActionItem(idx)}
                          className={`flex items-start gap-3 p-3 rounded-2xl border transition cursor-pointer select-none ${
                            isChecked
                              ? "bg-emerald-950/20 border-emerald-800/40 opacity-70"
                              : "bg-slate-950/40 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="mt-0.5 w-4 h-4 rounded text-blue-600 bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer"
                          />
                          <span
                            className={`text-xs leading-relaxed ${
                              isChecked
                                ? "line-through text-slate-500"
                                : "text-slate-200 font-medium"
                            }`}
                          >
                            {item}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">
                    No immediate action items found in the conversation.
                  </p>
                )}
              </div>
            </div>

            {/* Collapsible Scoped "Ask About This Call" Panel */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl overflow-hidden shadow-xl transition-all">
              <button
                onClick={() => setIsChatOpen((prev) => !prev)}
                className="w-full flex items-center justify-between p-6 hover:bg-slate-800/30 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-lg shadow-sm">
                    💬
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                      <span>Ask About This Call</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-medium">
                        AI Scoped
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Query this specific call's discussions, decisions, and speaker statements
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-400 font-semibold hidden sm:inline">
                    {isChatOpen ? "Collapse Chat" : "Open Chat Panel"}
                  </span>
                  <span className="text-slate-400 text-xs px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 font-medium">
                    {isChatOpen ? "▲ Hide" : "▼ Open"}
                  </span>
                </div>
              </button>

              {isChatOpen && (
                <div className="p-4 sm:p-6 border-t border-slate-800/80 bg-slate-950/40">
                  <AskCallsChat callId={callId} isPanel={true} />
                </div>
              )}
            </div>

            {/* Full Chronological Transcript Section */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📜</span>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                    Full Call Transcript
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {transcriptLines.length} recorded lines
                </span>
              </div>

              {transcriptLines.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2 pt-1">
                  {transcriptLines.map((line, idx) => {
                    const formattedTime = new Date(line.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    const isCurrentUser = line.speaker_id === user?.id;

                    return (
                      <div
                        key={line.id || idx}
                        className="bg-slate-950/50 border border-slate-800/80 rounded-2xl p-3.5 space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className={`font-semibold px-2 py-0.5 rounded-md text-[11px] ${
                              isCurrentUser
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            }`}
                          >
                            {isCurrentUser ? "You" : "Peer"}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {formattedTime}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed pl-1 pt-1">
                          {line.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic py-6 text-center">
                  No transcript lines were captured for this session.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
