import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

/**
 * Metric Tooltip Content Descriptions for Viva / User Explanation
 */
const METRIC_INFO = {
  rtt: "Round-Trip Time: The round-trip delay time taken for an audio packet to travel to the peer and back (ideal: < 150 ms).",
  jitter: "Jitter: Statistical variation in packet transit delay across the network. High jitter creates robotic or staggered audio (ideal: < 30 ms).",
  packetLoss: "Packet Loss: Percentage of audio packets lost during UDP transmission. Causes audio cutouts or dropouts (ideal: < 1%).",
  bitrate: "Current Bitrate: The throughput speed of received audio data in kilobits per second (standard Opus codec runs at 24-40 kbps).",
  mos: "MOS (Mean Opinion Score): Industry standard (ITU-T G.107 E-model) rating from 1.0 (unacceptable) to 5.0 (crystal clear) reflecting perceived voice quality.",
};

export default function QoSPanel({
  stats,
  averages,
  history,
  connectionState,
}) {
  const isConnected = connectionState === "connected";

  // Badge colors based on ITU-T MOS rating
  const getMosBadge = (label) => {
    switch (label) {
      case "Excellent":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
      case "Good":
        return "bg-blue-500/20 text-blue-400 border-blue-500/40";
      case "Fair":
        return "bg-amber-500/20 text-amber-400 border-amber-500/40";
      default:
        return "bg-rose-500/20 text-rose-400 border-rose-500/40";
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">📊</span>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              Real-Time VoIP Quality of Service (QoS)
            </h3>
            <p className="text-[11px] text-slate-400">
              Native WebRTC <code>RTCPeerConnection.getStats()</code> diagnostics
            </p>
          </div>
        </div>

        {/* Live MOS Rating Badge */}
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 uppercase font-bold block">
              MOS Score
            </span>
            <span className="text-sm font-black font-mono text-white">
              {isConnected ? stats.mos.toFixed(2) : "—"}
            </span>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-lg border font-bold uppercase tracking-wider ${
              isConnected ? getMosBadge(stats.qualityLabel) : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            {isConnected ? stats.qualityLabel : "Offline"}
          </span>
        </div>
      </div>

      {/* Primary Metrics Grid (RTT, Jitter, Packet Loss, Bitrate) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: RTT */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 relative group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              RTT
            </span>
            <span
              title={METRIC_INFO.rtt}
              className="w-4 h-4 rounded-full bg-slate-800 text-slate-400 text-[10px] flex items-center justify-center cursor-help"
            >
              ?
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-white">
              {isConnected ? stats.rtt.toFixed(0) : "0"}
            </span>
            <span className="text-xs text-slate-500 font-mono">ms</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            Avg: {isConnected ? averages.avgRtt : "0"} ms
          </span>
        </div>

        {/* Metric 2: Jitter */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 relative group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Jitter
            </span>
            <span
              title={METRIC_INFO.jitter}
              className="w-4 h-4 rounded-full bg-slate-800 text-slate-400 text-[10px] flex items-center justify-center cursor-help"
            >
              ?
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-sky-400">
              {isConnected ? stats.jitter.toFixed(1) : "0.0"}
            </span>
            <span className="text-xs text-slate-500 font-mono">ms</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            Avg: {isConnected ? averages.avgJitter : "0.0"} ms
          </span>
        </div>

        {/* Metric 3: Packet Loss */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 relative group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Packet Loss
            </span>
            <span
              title={METRIC_INFO.packetLoss}
              className="w-4 h-4 rounded-full bg-slate-800 text-slate-400 text-[10px] flex items-center justify-center cursor-help"
            >
              ?
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span
              className={`text-xl font-bold font-mono ${
                stats.packetLoss > 2 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {isConnected ? stats.packetLoss.toFixed(1) : "0.0"}
            </span>
            <span className="text-xs text-slate-500 font-mono">%</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            Avg: {isConnected ? averages.avgPacketLoss : "0.0"}%
          </span>
        </div>

        {/* Metric 4: Bitrate */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 relative group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Bitrate
            </span>
            <span
              title={METRIC_INFO.bitrate}
              className="w-4 h-4 rounded-full bg-slate-800 text-slate-400 text-[10px] flex items-center justify-center cursor-help"
            >
              ?
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-purple-400">
              {isConnected ? stats.bitrate.toFixed(1) : "0.0"}
            </span>
            <span className="text-xs text-slate-500 font-mono">kbps</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            Inbound Audio
          </span>
        </div>
      </div>

      {/* 60-Second Real-Time Jitter & Packet Loss Line Chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Network Stability (Last 60 Seconds)
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            {history.length} / 60 samples
          </span>
        </div>

        <div className="h-36 w-full bg-slate-950/80 border border-slate-800/80 rounded-2xl p-2 pt-3">
          {history.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                <XAxis dataKey="time" hide />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "0.75rem",
                    fontSize: "11px",
                    color: "#f8fafc",
                  }}
                  itemStyle={{ padding: "1px 0" }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={24}
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px" }}
                />
                <Line
                  type="monotone"
                  dataKey="jitter"
                  name="Jitter (ms)"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="packetLoss"
                  name="Packet Loss (%)"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-600 font-mono">
              Collecting real-time WebRTC RTP metrics...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
