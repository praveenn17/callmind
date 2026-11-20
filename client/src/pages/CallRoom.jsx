import React, { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import QoSPanel from "../components/QoSPanel";

import { getIceServerConfig } from "../utils/iceConfig";

// Read configuration from Vite environment variables
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

// Supported languages for speech recognition dropdown
const SUPPORTED_LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "hi-IN", label: "Hindi (India)" },
  { code: "ta-IN", label: "Tamil (India)" },
  { code: "te-IN", label: "Telugu (India)" },
  { code: "bn-IN", label: "Bengali (India)" },
];

export default function CallRoom() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Call connection states
  const [connectionState, setConnectionState] = useState("connecting"); // connecting, connected, disconnected, failed
  const [isMuted, setIsMuted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Initializing audio and signaling...");
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [callId, setCallId] = useState(null);
  const [dbError, setDbError] = useState(null);

  // Speech-to-Text states
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState("en-IN");
  const [transcriptLines, setTranscriptLines] = useState([]);
  const [interimText, setInterimText] = useState("");
  const [isListening, setIsListening] = useState(false);

  // QoS Real-Time Metrics & Running Averages (Polled via getStats every 1s)
  const [qosStats, setQosStats] = useState({
    rtt: 0,
    jitter: 0,
    packetLoss: 0,
    bitrate: 0,
    mos: 4.5,
    qualityLabel: "Excellent",
  });
  const [qosAverages, setQosAverages] = useState({
    avgRtt: 0,
    avgJitter: 0,
    avgPacketLoss: 0,
  });
  const [qosHistory, setQosHistory] = useState([]);

  // Screen Sharing states
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [remoteScreenStream, setRemoteScreenStream] = useState(null);

  // References across re-renders
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const recognitionRef = useRef(null);
  const isCallActiveRef = useRef(true);
  const pendingIceCandidatesRef = useRef([]);
  const transcriptBottomRef = useRef(null);

  // Screen Sharing References
  const screenStreamRef = useRef(null);
  const screenSenderRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const isPeerConnectedRef = useRef(false);
  const isNegotiatingRef = useRef(false);

  // Supabase Persistence & QoS Tracking References
  const isHostRef = useRef(false);
  const callIdRef = useRef(null);
  const startTimeRef = useRef(null);
  const hasCreatedCallRef = useRef(false);
  const hasEndedCallRef = useRef(false);
  const pendingTranscriptBatchRef = useRef([]);
  const qosAveragesRef = useRef({ avgRtt: 0, avgJitter: 0, avgPacketLoss: 0 });
  const prevStatsRef = useRef({ bytesReceived: 0, timestamp: 0 });
  const qosSamplesRef = useRef([]);

  const roomId = (roomCode || "").toUpperCase();
  const currentSpeakerName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "You";

  useEffect(() => {
    document.title = roomId ? `Active Call (${roomId}) | CallMind` : "Call Room | CallMind";
  }, [roomId]);

  // Auto-scroll transcript container as new lines arrive
  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptLines, interimText]);

  // Bind remote screen sharing stream to the video DOM element
  useEffect(() => {
    if (remoteVideoRef.current) {
      if (remoteScreenStream) {
        remoteVideoRef.current.srcObject = remoteScreenStream;
        remoteVideoRef.current.play().catch((err) => {
          console.warn("[ScreenShare] Remote video playback autoplay notice:", err);
        });
      } else {
        remoteVideoRef.current.srcObject = null;
      }
    }
  }, [remoteScreenStream]);

  // Keep qosAveragesRef in sync for end-of-call updates
  useEffect(() => {
    qosAveragesRef.current = qosAverages;
  }, [qosAverages]);

  // Main lifecycle for call & speech recognition
  useEffect(() => {
    if (!roomId) {
      navigate("/dashboard");
      return;
    }

    isCallActiveRef.current = true;
    startCallSession();

    return () => {
      isCallActiveRef.current = false;
      stopSpeechRecognition();
      endCallSession(false);
    };
  }, [roomId]);

  /**
   * Batch write transcript lines to Supabase every 3 seconds
   */
  useEffect(() => {
    const batchInterval = setInterval(() => {
      flushTranscriptBatch();
    }, 3000);

    return () => {
      clearInterval(batchInterval);
    };
  }, []);

  /**
   * Handle tab close / refresh: persist ended_at, duration and QoS via beacon/keepalive
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (callIdRef.current && !hasEndedCallRef.current) {
        hasEndedCallRef.current = true;
        const durationSeconds = startTimeRef.current
          ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
          : 0;

        const payload = JSON.stringify({
          ended_at: new Date().toISOString(),
          duration_seconds: durationSeconds,
          avg_jitter_ms: qosAveragesRef.current.avgJitter || 0,
          avg_packet_loss: qosAveragesRef.current.avgPacketLoss || 0,
          avg_rtt_ms: qosAveragesRef.current.avgRtt || 0,
        });

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseAnonKey) {
          fetch(`${supabaseUrl}/rest/v1/calls?id=eq.${callIdRef.current}`, {
            method: "PATCH",
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, []);

  /**
   * Host creates call row in Supabase and transmits callId to Guest
   */
  const createCallRecordAsHost = async () => {
    if (!isHostRef.current || hasCreatedCallRef.current || !user?.id) {
      return;
    }
    hasCreatedCallRef.current = true;
    startTimeRef.current = Date.now();

    try {
      const { data, error } = await supabase
        .from("calls")
        .insert([
          {
            room_code: roomId,
            host_id: user.id,
          },
        ])
        .select()
        .single();

      if (error) {
        console.warn("[Supabase] Failed to insert call row:", error);
        setDbError("Call sync notice: Unable to save call session to database (" + error.message + ").");
        return;
      }

      if (data?.id) {
        console.log("[Supabase] Call created with ID:", data.id);
        callIdRef.current = data.id;
        setCallId(data.id);

        // Share the call id with the guest through the data channel
        sendDataChannelPayload({
          type: "call-init",
          callId: data.id,
        });
      }
    } catch (err) {
      console.warn("[Supabase] Exception inserting call row:", err);
      setDbError("Call sync notice: database write encountered an issue.");
    }
  };

  /**
   * Guest receives callId from Host and updates guest_id in Supabase
   */
  const registerGuestInCall = async (incomingCallId) => {
    if (!incomingCallId || !user?.id) return;
    callIdRef.current = incomingCallId;
    setCallId(incomingCallId);
    startTimeRef.current = Date.now();

    try {
      const { error } = await supabase
        .from("calls")
        .update({ guest_id: user.id })
        .eq("id", incomingCallId);

      if (error) {
        console.warn("[Supabase] Failed to update guest_id:", error);
        setDbError("Call sync notice: could not link guest to call record (" + error.message + ").");
      } else {
        console.log("[Supabase] Guest ID updated for call ID:", incomingCallId);
      }
    } catch (err) {
      console.warn("[Supabase] Exception updating guest_id:", err);
    }
  };

  /**
   * Flush pending final transcript lines to Supabase in batches
   */
  const flushTranscriptBatch = async () => {
    if (!callIdRef.current || pendingTranscriptBatchRef.current.length === 0) {
      return;
    }

    const itemsToWrite = pendingTranscriptBatchRef.current.splice(0);
    const rows = itemsToWrite.map((item) => ({
      call_id: callIdRef.current,
      speaker_id: item.speaker_id || user?.id,
      text: item.text,
    }));

    try {
      const { error } = await supabase.from("transcript_lines").insert(rows);
      if (error) {
        console.warn("[Supabase] Failed to persist transcript batch:", error);
        setDbError("Transcript sync notice: " + error.message);
        // Put unwritten lines back in queue for retry
        pendingTranscriptBatchRef.current.unshift(...itemsToWrite);
      } else {
        console.log(`[Supabase] Persisted ${rows.length} transcript lines`);
      }
    } catch (err) {
      console.warn("[Supabase] Error writing transcript batch:", err);
      pendingTranscriptBatchRef.current.unshift(...itemsToWrite);
    }
  };

  /**
   * Finalize call row in Supabase with ended_at, duration and average QoS metrics
   */
  const finalizeCallRecord = async () => {
    if (!callIdRef.current || hasEndedCallRef.current) return;
    hasEndedCallRef.current = true;

    // Flush any leftover transcript lines
    await flushTranscriptBatch();

    const durationSeconds = startTimeRef.current
      ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
      : 0;

    const updatePayload = {
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      avg_jitter_ms: qosAveragesRef.current.avgJitter || 0,
      avg_packet_loss: qosAveragesRef.current.avgPacketLoss || 0,
      avg_rtt_ms: qosAveragesRef.current.avgRtt || 0,
    };

    try {
      const { error } = await supabase
        .from("calls")
        .update(updatePayload)
        .eq("id", callIdRef.current);

      if (error) {
        console.warn("[Supabase] Failed to update call end stats:", error);
      } else {
        console.log("[Supabase] Call finalized successfully:", updatePayload);
      }
    } catch (err) {
      console.warn("[Supabase] Exception finalizing call:", err);
    }
  };

  /**
   * QoS Diagnostics Polling: RTCPeerConnection.getStats() every 1s while connected
   */
  useEffect(() => {
    if (connectionState !== "connected") {
      return;
    }

    // When connection establishes, if host, insert row in calls
    if (isHostRef.current && !hasCreatedCallRef.current) {
      createCallRecordAsHost();
    }

    const pollInterval = setInterval(async () => {
      const pc = peerConnectionRef.current;
      if (!pc || pc.connectionState !== "connected") return;

      try {
        const stats = await pc.getStats();
        let rtt = 0;
        let jitter = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let currentBytesReceived = 0;
        let currentTimestamp = 0;

        stats.forEach((report) => {
          if (
            report.type === "candidate-pair" &&
            (report.state === "succeeded" || report.nominated) &&
            report.currentRoundTripTime !== undefined
          ) {
            rtt = report.currentRoundTripTime * 1000;
          } else if (
            report.type === "remote-inbound-rtp" &&
            report.roundTripTime !== undefined
          ) {
            rtt = report.roundTripTime * 1000;
          }

          if (report.type === "inbound-rtp" && report.kind === "audio") {
            if (report.jitter !== undefined) {
              jitter = report.jitter * 1000;
            }
            if (report.packetsLost !== undefined) {
              packetsLost = report.packetsLost;
            }
            if (report.packetsReceived !== undefined) {
              packetsReceived = report.packetsReceived;
            }
            if (report.bytesReceived !== undefined) {
              currentBytesReceived = report.bytesReceived;
              currentTimestamp = report.timestamp;
            }
          }
        });

        const totalPackets = packetsLost + packetsReceived;
        const packetLossPct =
          totalPackets > 0
            ? (Math.max(0, packetsLost) / totalPackets) * 100
            : 0;

        let bitrateKbps = 0;
        if (
          prevStatsRef.current.timestamp > 0 &&
          currentTimestamp > prevStatsRef.current.timestamp
        ) {
          const deltaBytes =
            currentBytesReceived - prevStatsRef.current.bytesReceived;
          const deltaTimeMs = currentTimestamp - prevStatsRef.current.timestamp;
          if (deltaBytes >= 0 && deltaTimeMs > 0) {
            bitrateKbps = (deltaBytes * 8) / deltaTimeMs;
          }
        }
        prevStatsRef.current = {
          bytesReceived: currentBytesReceived,
          timestamp: currentTimestamp,
        };

        const effectiveLatency = rtt / 2 + jitter * 2;
        let R = 94.0;
        if (effectiveLatency > 160) {
          R -= (effectiveLatency - 160) / 40;
        } else if (effectiveLatency > 0) {
          R -= effectiveLatency * 0.02;
        }
        R -= packetLossPct * 2.5;
        R = Math.max(0, Math.min(100, R));

        let mos = 1.0;
        if (R > 0) {
          mos = 1 + 0.035 * R + R * (100 - R) * (R - 60) * 0.000007;
        }
        mos = Math.max(1.0, Math.min(5.0, Number(mos.toFixed(2))));

        let qualityLabel = "Poor";
        if (mos >= 4.0) qualityLabel = "Excellent";
        else if (mos >= 3.6) qualityLabel = "Good";
        else if (mos >= 3.0) qualityLabel = "Fair";

        setQosStats({
          rtt,
          jitter,
          packetLoss: packetLossPct,
          bitrate: bitrateKbps,
          mos,
          qualityLabel,
        });

        qosSamplesRef.current.push({ rtt, jitter, packetLoss: packetLossPct });
        const count = qosSamplesRef.current.length;
        const sum = qosSamplesRef.current.reduce(
          (acc, item) => ({
            rtt: acc.rtt + item.rtt,
            jitter: acc.jitter + item.jitter,
            packetLoss: acc.packetLoss + item.packetLoss,
          }),
          { rtt: 0, jitter: 0, packetLoss: 0 }
        );

        const newAverages = {
          avgRtt: Number((sum.rtt / count).toFixed(1)),
          avgJitter: Number((sum.jitter / count).toFixed(1)),
          avgPacketLoss: Number((sum.packetLoss / count).toFixed(2)),
        };
        setQosAverages(newAverages);

        const timeStr = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        setQosHistory((prev) => {
          const next = [
            ...prev,
            {
              time: timeStr,
              jitter: Number(jitter.toFixed(1)),
              packetLoss: Number(packetLossPct.toFixed(1)),
            },
          ];
          return next.length > 60 ? next.slice(-60) : next;
        });
      } catch (err) {
        console.warn("[QoS] getStats polling error:", err);
      }
    }, 1000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [connectionState]);

  const getLocalAudioStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      return stream;
    } catch (err) {
      console.error("Failed to access microphone:", err);
      alert("Microphone access is required for VoIP audio calls. Please allow permission.");
      throw err;
    }
  };

  /**
   * Setup WebRTC RTCDataChannel listeners for exchanging transcripts & call metadata
   */
  const setupDataChannel = (channel) => {
    dataChannelRef.current = channel;

    channel.onopen = () => {
      console.log("[DataChannel] RTCDataChannel is OPEN");
      // If host has already generated a callId, share it immediately upon channel open
      if (isHostRef.current && callIdRef.current) {
        sendDataChannelPayload({
          type: "call-init",
          callId: callIdRef.current,
        });
      }
    };

    channel.onclose = () => {
      console.log("[DataChannel] RTCDataChannel is CLOSED");
    };

    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        // Case 1: Call initialization message from Host -> Guest
        if (payload.type === "call-init" && payload.callId) {
          console.log("[DataChannel] Guest received callId:", payload.callId);
          registerGuestInCall(payload.callId);
          return;
        }

        // Case 2: Screen share status update from peer
        if (payload.type === "screen-share-status") {
          console.log("[DataChannel] Peer screen share status:", payload.isSharing);
          if (!payload.isSharing) {
            setRemoteScreenStream(null);
          }
          return;
        }

        // Case 3: Transcript line message
        if (payload.type === "transcript" && payload.line) {
          setTranscriptLines((prev) => [...prev, payload.line]);
          return;
        }

        // Fallback for legacy format
        if (payload.speakerName && payload.text) {
          setTranscriptLines((prev) => [...prev, payload]);
        }
      } catch (err) {
        console.error("Error parsing incoming DataChannel message:", err);
      }
    };
  };

  const sendDataChannelPayload = (payload) => {
    const channel = dataChannelRef.current;
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(payload));
    } else {
      console.warn("[DataChannel] Channel not open yet. readyState:", channel?.readyState);
    }
  };

  /**
   * Initialize Web Speech API for Live Audio Transcription
   */
  const initSpeechRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("[Speech] Web Speech API not supported in this browser.");
      setIsSpeechSupported(false);
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedLanguage;

    recognition.onstart = () => {
      setIsListening(true);
      console.log("[Speech] Recognition started with language:", recognition.lang);
    };

    recognition.onresult = (event) => {
      let currentInterim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          const cleanText = text.trim();
          if (cleanText) {
            const line = {
              speakerId: user?.id || "local-user",
              speakerName: currentSpeakerName,
              text: cleanText,
              timestamp: new Date().toISOString(),
            };

            // 1. Add to local state for display
            setTranscriptLines((prev) => [...prev, line]);
            setInterimText("");

            // 2. Share with remote peer over RTCDataChannel
            sendDataChannelPayload({
              type: "transcript",
              line,
            });

            // 3. Queue for batched Supabase write
            pendingTranscriptBatchRef.current.push({
              speaker_id: user?.id,
              text: cleanText,
            });
          }
        } else {
          currentInterim += text;
        }
      }

      setInterimText(currentInterim);
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        return;
      }
      console.warn("[Speech] Recognition error:", event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (isCallActiveRef.current) {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
    }

    recognitionRef.current = recognition;
    return recognition;
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
      setIsListening(false);
    }
  };

  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    setSelectedLanguage(newLang);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = newLang;
        recognitionRef.current.stop();
      } catch (err) {
        console.error("Error updating speech recognition language:", err);
      }
    }
  };

  const createPeerConnection = (stream, socket) => {
    const config = getIceServerConfig();
    console.log("[WebRTC] Creating RTCPeerConnection with ICE config:", config);
    const pc = new RTCPeerConnection(config);

    stream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("ice-candidate", {
          roomId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("[WebRTC] Received remote track:", event.track.kind);
      if (event.track.kind === "audio") {
        if (remoteAudioRef.current) {
          if (event.streams && event.streams[0]) {
            remoteAudioRef.current.srcObject = event.streams[0];
          } else {
            remoteAudioRef.current.srcObject = new MediaStream([event.track]);
          }
        }
      } else if (event.track.kind === "video") {
        console.log("[WebRTC] Received remote screen video track.");
        const incomingStream =
          event.streams && event.streams[0]
            ? event.streams[0]
            : new MediaStream([event.track]);
        setRemoteScreenStream(incomingStream);

        // Hide video panel if remote peer stops sharing or ends track
        event.track.onended = () => {
          console.log("[WebRTC] Remote screen video track ended.");
          setRemoteScreenStream(null);
        };

        event.track.onmute = () => {
          console.log("[WebRTC] Remote screen video track muted.");
          setRemoteScreenStream(null);
        };

        event.track.onunmute = () => {
          console.log("[WebRTC] Remote screen video track unmuted.");
          setRemoteScreenStream(incomingStream);
        };
      }
    };

    pc.ondatachannel = (event) => {
      console.log("[WebRTC] Received incoming DataChannel from peer.");
      setupDataChannel(event.channel);
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state changed:", pc.connectionState);
      setConnectionState(pc.connectionState);
      if (pc.connectionState === "connected") {
        isPeerConnectedRef.current = true;
        setStatusMessage("P2P Audio Connected");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        isPeerConnectedRef.current = false;
        setStatusMessage("Connection lost or disconnected");
      }
    };

    /**
     * WebRTC Renegotiation:
     * Triggered automatically when addTrack() or removeTrack() modifies the stream tracks.
     * Works in both directions (host or guest can share screen).
     */
    pc.onnegotiationneeded = async () => {
      if (!isPeerConnectedRef.current && pc.connectionState !== "connected") {
        return;
      }
      if (isNegotiatingRef.current || pc.signalingState !== "stable") {
        console.log("[WebRTC] onnegotiationneeded deferred, state:", pc.signalingState);
        return;
      }

      isNegotiatingRef.current = true;
      try {
        console.log("[WebRTC] onnegotiationneeded: creating renegotiation offer...");
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);

        socket.emit("offer", {
          roomId,
          offer: pc.localDescription,
        });
      } catch (err) {
        console.error("[WebRTC] Error during negotiationneeded offer creation:", err);
      } finally {
        isNegotiatingRef.current = false;
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const initSocket = (stream) => {
    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;
    const pc = createPeerConnection(stream, socket);

    socket.on("room-joined", ({ isInitiator }) => {
      isHostRef.current = !!isInitiator;
      setIsHost(!!isInitiator);

      setStatusMessage(
        isInitiator
          ? "Waiting for another participant to join..."
          : "Connecting to call participant..."
      );
      setConnectionState("connecting");
    });

    socket.on("room-full", ({ message }) => {
      alert(message || "Room is full. Maximum 2 participants allowed.");
      endCallSession(true);
    });

    socket.on("user-joined", async () => {
      console.log("[Signaling] Another user joined. Creating DataChannel and Offer...");
      setStatusMessage("Peer joined. Negotiating connection...");

      const dataChannel = pc.createDataChannel("transcript", { ordered: true });
      setupDataChannel(dataChannel);

      await createAndSendOffer(pc, socket);
    });

    socket.on("offer", async ({ offer }) => {
      console.log("[Signaling] Received WebRTC offer.");
      await handleReceiveOffer(pc, socket, offer);
    });

    socket.on("answer", async ({ answer }) => {
      console.log("[Signaling] Received WebRTC answer.");
      await handleReceiveAnswer(pc, answer);
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      await handleReceiveIceCandidate(pc, candidate);
    });

    socket.on("user-left", () => {
      console.log("[Signaling] Remote peer left the room.");
      setStatusMessage("Remote peer has disconnected.");
      setConnectionState("disconnected");
      isPeerConnectedRef.current = false;
      setRemoteScreenStream(null);
      if (screenStreamRef.current) {
        stopScreenShare();
      }
      finalizeCallRecord();
      cleanupPeerConnection();
    });

    socket.on("connect", () => {
      console.log("[Socket Connected] Joining room:", roomId);
      socket.emit("join-room", { roomId });
    });

    return socket;
  };

  const createAndSendOffer = async (pc, socket) => {
    try {
      if (!pc || !socket) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("offer", {
        roomId,
        offer,
      });
    } catch (err) {
      console.error("Error creating WebRTC offer:", err);
    }
  };

  const handleReceiveOffer = async (pc, socket, offer) => {
    try {
      if (!pc || !socket) return;

      // Handle collision / glare during renegotiation
      if (pc.signalingState !== "stable") {
        if (!isHostRef.current) {
          await pc.setLocalDescription({ type: "rollback" });
        } else {
          return;
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      while (pendingIceCandidatesRef.current.length > 0) {
        const candidate = pendingIceCandidatesRef.current.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", {
        roomId,
        answer,
      });

      // If renegotiation resulted in no active remote video receivers, hide screen
      const activeVideoReceivers = pc
        .getReceivers()
        .filter(
          (r) =>
            r.track &&
            r.track.kind === "video" &&
            !r.track.muted &&
            r.track.readyState === "live"
        );
      if (activeVideoReceivers.length === 0 && !screenSenderRef.current) {
        setRemoteScreenStream(null);
      }
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  };

  const handleReceiveAnswer = async (pc, answer) => {
    try {
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      while (pendingIceCandidatesRef.current.length > 0) {
        const candidate = pendingIceCandidatesRef.current.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error("Error handling answer:", err);
    }
  };

  const handleReceiveIceCandidate = async (pc, candidate) => {
    try {
      if (!pc || !candidate) return;

      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        pendingIceCandidatesRef.current.push(candidate);
      }
    } catch (err) {
      console.error("Error adding received ICE candidate:", err);
    }
  };

  const startCallSession = async () => {
    try {
      const stream = await getLocalAudioStream();
      initSocket(stream);
      initSpeechRecognition();
    } catch (err) {
      console.error("Start call session error:", err);
      setStatusMessage("Failed to initialize call. Check microphone permissions.");
      setConnectionState("failed");
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  /**
   * Start Screen Sharing:
   * Prompts user with getDisplayMedia({ video: true }), adds the video track
   * to the peer connection via addTrack (which fires "negotiationneeded"),
   * and listens for the track's native "ended" event.
   */
  const startScreenShare = async () => {
    const pc = peerConnectionRef.current;
    if (!pc || connectionState !== "connected") {
      alert("Call must be connected before sharing screen.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      screenStreamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return;

      // Listen for browser's native "Stop Sharing" button or user ending display stream
      videoTrack.onended = () => {
        console.log("[ScreenShare] Native browser stop sharing button pressed.");
        stopScreenShare();
      };

      // Add track to existing RTCPeerConnection (triggers pc.onnegotiationneeded renegotiation)
      const sender = pc.addTrack(videoTrack, stream);
      screenSenderRef.current = sender;
      setIsSharingScreen(true);

      // Notify remote peer over data channel for immediate responsiveness
      sendDataChannelPayload({
        type: "screen-share-status",
        isSharing: true,
      });
    } catch (err) {
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        console.error("Error accessing screen capture:", err);
        alert("Could not start screen sharing: " + err.message);
      }
    }
  };

  /**
   * Stop Screen Sharing:
   * Removes video track from RTCPeerConnection (triggers "negotiationneeded" renegotiation),
   * stops native screen media tracks, and notifies remote peer.
   */
  const stopScreenShare = () => {
    console.log("[ScreenShare] Stopping screen share...");
    const pc = peerConnectionRef.current;

    // 1. Remove track from RTCPeerConnection (fires pc.onnegotiationneeded)
    if (pc && screenSenderRef.current) {
      try {
        pc.removeTrack(screenSenderRef.current);
      } catch (err) {
        console.warn("[ScreenShare] Error removing screen track:", err);
      }
      screenSenderRef.current = null;
    }

    // 2. Stop native media tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        track.onended = null;
      });
      screenStreamRef.current = null;
    }

    setIsSharingScreen(false);

    // 3. Notify remote peer over RTCDataChannel
    sendDataChannelPayload({
      type: "screen-share-status",
      isSharing: false,
    });
  };

  const cleanupPeerConnection = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        track.onended = null;
      });
      screenStreamRef.current = null;
    }
    screenSenderRef.current = null;
    setIsSharingScreen(false);
    setRemoteScreenStream(null);
    isPeerConnectedRef.current = false;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    pendingIceCandidatesRef.current = [];
  };

  const endCallSession = async (shouldRedirect = true) => {
    isCallActiveRef.current = false;
    stopSpeechRecognition();

    const activeCallId = callIdRef.current;

    // Persist final call statistics to Supabase
    await finalizeCallRecord();

    if (socketRef.current) {
      socketRef.current.emit("leave", { roomId });
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    cleanupPeerConnection();

    setConnectionState("disconnected");
    setStatusMessage("Call ended");

    if (shouldRedirect) {
      if (activeCallId) {
        navigate(`/summary/${activeCallId}`);
      } else {
        navigate("/dashboard");
      }
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getConnectionBadgeClass = () => {
    switch (connectionState) {
      case "connected":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
      case "connecting":
        return "bg-amber-500/20 text-amber-400 border-amber-500/40";
      case "failed":
        return "bg-rose-500/20 text-rose-400 border-rose-500/40";
      default:
        return "bg-slate-700/40 text-slate-400 border-slate-600/40";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => endCallSession(true)}
              className="text-slate-400 hover:text-slate-200 transition text-sm flex items-center gap-1.5"
            >
              <span>←</span>
              <span>Dashboard</span>
            </button>
            <span className="text-slate-700">|</span>
            <span className="font-bold text-sm tracking-tight text-white">
              CallMind Intelligence Room
            </span>
          </div>

          <div className="flex items-center gap-3">
            {callId && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono hidden sm:inline-block">
                DB Synced
              </span>
            )}
            <span
              className={`text-xs px-3 py-1 rounded-full border font-semibold uppercase tracking-wider ${getConnectionBadgeClass()}`}
            >
              {connectionState}
            </span>
          </div>
        </div>
      </header>

      {/* Non-intrusive Database Notice Banner */}
      {dbError && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-amber-500/15 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{dbError}</span>
            </div>
            <button
              onClick={() => setDbError(null)}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Two-Column Call, QoS Diagnostics & Live Transcript View */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Call Controls & Real-Time QoS Panel */}
        <section className="lg:col-span-6 space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur">
            <div className="text-center mb-6">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
                Room Code ({isHost ? "Host" : "Guest"})
              </p>
              <div className="inline-flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-2xl px-5 py-2 mt-1">
                <span className="font-mono text-2xl font-bold tracking-widest text-blue-400">
                  {roomId}
                </span>
                <button
                  onClick={copyRoomCode}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div className="flex justify-center items-center gap-6 py-4 mb-4">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center text-xl border-2 transition ${
                    isMuted
                      ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
                      : "bg-blue-600/20 border-blue-500 text-blue-400 shadow-lg shadow-blue-500/20"
                  }`}
                >
                  🎙️
                </div>
                <span className="text-xs font-medium text-slate-300">
                  You ({isMuted ? "Muted" : "Speaking"})
                </span>
              </div>

              <div className="text-slate-600 text-lg font-bold">⇌</div>

              <div className="flex flex-col items-center gap-2">
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center text-xl border-2 transition ${
                    connectionState === "connected"
                      ? "bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-500/20 animate-pulse"
                      : "bg-slate-800 border-slate-700 text-slate-600"
                  }`}
                >
                  👤
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {connectionState === "connected" ? "Peer Live" : "Waiting"}
                </span>
              </div>
            </div>

            <div className="mb-6 px-4 py-2 rounded-xl bg-slate-950/60 border border-slate-800/80 text-center">
              <p className="text-xs text-slate-300 font-mono">{statusMessage}</p>
            </div>

            {/* Active Screen Sharing Banner */}
            {isSharingScreen && (
              <div className="mb-4 bg-blue-950/40 border border-blue-500/40 rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg shadow-blue-500/5">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                  </span>
                  <span className="text-xs font-semibold text-blue-300">
                    You are sharing your screen
                  </span>
                </div>
                <button
                  onClick={stopScreenShare}
                  className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/20 hover:bg-rose-500/20 text-blue-300 hover:text-rose-300 border border-blue-500/30 hover:border-rose-500/40 font-medium transition"
                >
                  Stop Sharing
                </button>
              </div>
            )}

            <div className="mb-6 space-y-2">
              <label
                htmlFor="language-select"
                className="block text-xs font-semibold text-slate-400 uppercase tracking-wider"
              >
                Speech Recognition Language
              </label>
              <select
                id="language-select"
                value={selectedLanguage}
                onChange={handleLanguageChange}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label} ({lang.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={toggleMute}
                className={`py-3 px-3 rounded-xl font-semibold text-xs transition border flex items-center justify-center gap-2 ${
                  isMuted
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                    : "bg-slate-800 hover:bg-slate-700/80 text-slate-200 border-slate-700"
                }`}
              >
                <span>{isMuted ? "🎙️ Unmute" : "🎙️ Mute"}</span>
              </button>

              <button
                onClick={isSharingScreen ? stopScreenShare : startScreenShare}
                disabled={connectionState !== "connected"}
                className={`py-3 px-3 rounded-xl font-semibold text-xs transition border flex items-center justify-center gap-2 ${
                  isSharingScreen
                    ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/30 hover:bg-blue-500"
                    : "bg-slate-800 hover:bg-slate-700/80 text-slate-200 border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <span>🖥️</span>
                <span>{isSharingScreen ? "Stop Sharing" : "Share Screen"}</span>
              </button>

              <button
                onClick={() => endCallSession(true)}
                className="py-3 px-3 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <span>Hang Up</span>
              </button>
            </div>
          </div>

          <QoSPanel
            stats={qosStats}
            averages={qosAverages}
            history={qosHistory}
            connectionState={connectionState}
          />

          {!isSpeechSupported && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
              <p className="font-semibold mb-1">Speech Recognition Not Supported</p>
              <p className="text-[11px] text-amber-300/80">
                Your browser does not support the Web Speech API (<code>webkitSpeechRecognition</code>). Please use Google Chrome or Microsoft Edge to enable real-time speech transcription.
              </p>
            </div>
          )}
        </section>

        {/* Right Column: Remote Screen Share & Live Transcript Panel */}
        <section className="lg:col-span-6 space-y-6">
          {/* Remote Screen Share Video Panel (Displayed when remote peer shares screen) */}
          {remoteScreenStream && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                    <span>🖥️</span>
                    <span>Remote Screen Presentation</span>
                  </h3>
                </div>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  Live Stream
                </span>
              </div>
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border border-slate-800/90 shadow-inner">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}

          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur flex flex-col h-[750px]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">📝</span>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    Live Call Transcription
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Real-time speech-to-text synced via WebRTC RTCDataChannel &amp; Supabase
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isListening ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                  }`}
                ></span>
                <span className="text-[11px] font-mono text-slate-400">
                  {isListening ? "Listening..." : "Inactive"}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-2">
              {transcriptLines.length === 0 && !interimText && (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 space-y-2 py-12">
                  <span className="text-3xl">🎙️</span>
                  <p className="text-xs font-medium text-slate-400">
                    Transcript will appear here as you speak.
                  </p>
                  <p className="text-[11px] text-slate-600 max-w-xs">
                    Each participant's voice is transcribed locally and exchanged directly over the peer-to-peer data channel.
                  </p>
                </div>
              )}

              {transcriptLines.map((line, index) => {
                const isLocal =
                  line.speakerId === user?.id || line.speakerName === currentSpeakerName;
                const formattedTime = new Date(line.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });

                return (
                  <div
                    key={index}
                    className="flex flex-col items-start bg-slate-950/50 border border-slate-800/80 rounded-2xl p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between w-full text-xs">
                      <span
                        className={`font-semibold px-2 py-0.5 rounded-md text-[11px] ${
                          isLocal
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                        }`}
                      >
                        {line.speakerName} {isLocal && "(You)"}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {formattedTime}
                      </span>
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed pl-1">
                      {line.text}
                    </p>
                  </div>
                );
              })}

              {interimText && (
                <div className="bg-blue-950/20 border border-blue-800/30 rounded-2xl p-3.5 space-y-1.5 animate-pulse">
                  <div className="flex items-center justify-between w-full text-xs">
                    <span className="font-semibold text-blue-400 text-[11px] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping"></span>
                      {currentSpeakerName} (Speaking...)
                    </span>
                    <span className="text-[10px] text-blue-400/60 font-mono">
                      Live
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 italic leading-relaxed pl-1">
                    "{interimText}"
                  </p>
                </div>
              )}

              <div ref={transcriptBottomRef} />
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Language: <strong className="text-slate-400">{selectedLanguage}</strong>
              </span>
              <span>
                {transcriptLines.length} finalized line{transcriptLines.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
