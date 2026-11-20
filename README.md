# CallMind — AI Call Intelligence & VoIP Platform

> **Final-Year Project on Voice over IP (VoIP)**  
> An end-to-end, browser-native WebRTC audio calling system paired with live in-browser speech-to-text, real-time ITU-T G.107 Quality of Service (QoS) diagnostics, and server-side generative AI intelligence powered by Google Gemini Flash.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph ClientA["Client Peer A (Host)"]
        UI_A["React + Tailwind UI"]
        WebRTC_A["Native RTCPeerConnection"]
        STT_A["Web Speech API (Microphone)"]
        DC_A["RTCDataChannel (Transcript & Meta)"]
        QoS_A["getStats() E-Model Engine"]
    end

    subgraph ClientB["Client Peer B (Guest)"]
        UI_B["React + Tailwind UI"]
        WebRTC_B["Native RTCPeerConnection"]
        STT_B["Web Speech API (Microphone)"]
        DC_B["RTCDataChannel (Transcript & Meta)"]
        QoS_B["getStats() E-Model Engine"]
    end

    subgraph SignalingServer["Node.js + Express + Socket.io Server (Render)"]
        Signaling["WebRTC Signaling (Offer / Answer / ICE)"]
        RoomManager["Room Controller (Max 2 Peers)"]
        AI_Endpoint["POST /api/analyze-call (Gemini Flash)"]
        RateLimiter["In-Memory Rate Limiter"]
    end

    subgraph ExternalCloud["Cloud Infrastructure"]
        STUN_TURN["Metered.ca / Google STUN (NAT Traversal)"]
        Supabase["Supabase DB & Auth (RLS Enforced)"]
        Gemini["Google Gemini Flash API"]
    end

    %% Signaling
    UI_A <-->|Socket.io WebSocket| Signaling
    UI_B <-->|Socket.io WebSocket| Signaling

    %% Media & Data Channel (Direct P2P)
    WebRTC_A <-->|Direct Encrypted SRTP Audio Stream| WebRTC_B
    DC_A <-->|Direct Encrypted P2P SCTP Channel| DC_B

    %% NAT Traversal
    WebRTC_A -.->|ICE / STUN Binding / TURN Relay| STUN_TURN
    WebRTC_B -.->|ICE / STUN Binding / TURN Relay| STUN_TURN

    %% Database & Auth
    UI_A -->|Anon Key / RLS Auth & Batched Lines| Supabase
    UI_B -->|Anon Key / RLS Auth & Batched Lines| Supabase

    %% Server AI & Admin DB
    AI_Endpoint -->|Service Role Key (Admin Auth & Transcripts)| Supabase
    AI_Endpoint -->|Prompt + Transcript JSON| Gemini
```

---

## Key Features

1. **Native WebRTC Audio Engine:**
   - 100% native browser WebRTC API (`RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`).
   - Zero third-party WebRTC wrapper libraries (no SimplePeer, PeerJS, or LiveKit).
   - 1-on-1 private rooms enforced on the signaling layer (maximum 2 participants per room code).

2. **Real-Time Speech-to-Text & P2P Transcript Sync:**
   - Powered by the browser-native Web Speech API (`webkitSpeechRecognition`) in continuous interim mode.
   - Multilingual support with on-the-fly language switching (`en-IN`, `en-US`, `en-GB`, `hi-IN`, etc.).
   - Each participant transcribes only their own microphone audio.
   - Finalized dialogue is instantly transmitted to the remote peer over a native WebRTC `RTCDataChannel`.

3. **Live QoS Diagnostics & ITU-T G.107 E-Model MOS Scoring:**
   - Diagnosed every second via `RTCPeerConnection.getStats()` during active calls.
   - Computes:
     - **Round-Trip Time (RTT)** in milliseconds.
     - **Jitter** in milliseconds.
     - **Packet Loss Percentage** from inbound audio RTP packets.
     - **Current Bitrate** in kbps.
     - **Mean Opinion Score (MOS)** on a scale of 1.0 to 5.0 (categorized as *Excellent*, *Good*, *Fair*, or *Poor*).
   - Rolling 60-second real-time line chart plotted dynamically with Recharts.

4. **Post-Call Generative AI Intelligence (Google Gemini Flash):**
   - Invoked strictly from the Node.js server via `POST /api/analyze-call`.
   - Never exposes API keys or Supabase service credentials to the client.
   - Extracts structured JSON:
     - **Executive Summary:** High-level briefing of call discussions.
     - **Sentiment:** Tone classification (`positive`, `neutral`, `negative`).
     - **Key Topics:** Automatic theme tagging.
     - **Action Items:** Interactive checklist with completion state.

5. **Production Supabase Database & Auth (Row-Level Security):**
   - Tables: `profiles`, `calls`, `transcript_lines`, `call_summaries`.
   - Batched transcript writes every 3 seconds to optimize database I/O.
   - Tab-close and hang-up resilience via `keepalive` fetch hooks.

6. **Searchable Call Archive & Analytics:**
   - Unified search across transcript lines and AI summaries using Supabase `ilike` queries.
   - Sentiment filtering and pagination.
   - Aggregate dashboard metrics: total talk time, total sessions, historical MOS quality, and top topics.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS, React Router v6, Recharts |
| **Backend** | Node.js (ES modules), Express, Socket.io |
| **Media & P2P** | Browser Native WebRTC (`RTCPeerConnection`, `RTCDataChannel`, Web Speech API) |
| **Database & Auth** | Supabase (PostgreSQL with Row Level Security) |
| **AI Intelligence** | Google Gemini Flash (REST API with structured JSON output) |
| **NAT Traversal** | Google STUN + Metered.ca TURN (OpenRelay) |
| **Hosting** | Vercel (`/client`), Render Web Service (`/server`) |

---

## Local Setup & Development

### 1. Prerequisites
- Node.js `v18+` or `v20+` (tested on Node `v24`)
- npm `v9+`
- A free [Supabase](https://supabase.com) project
- A free [Google AI Studio](https://aistudio.google.com/) Gemini API key

### 2. Clone and Configure Environment Variables

#### Server Environment (`server/.env`)
Copy `server/.env.example` to `server/.env`:
```env
PORT=5000
CLIENT_URL=http://localhost:5173

# Supabase Server-side Admin (service_role key - NEVER expose to client)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Google Gemini API Key
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
```

#### Client Environment (`client/.env`)
Copy `client/.env.example` to `client/.env`:
```env
VITE_SERVER_URL=http://localhost:5000

# STUN/TURN ICE Servers
VITE_ICE_SERVERS=stun:stun.l.google.com:19302

# Optional Metered.ca TURN credentials for NAT traversal:
VITE_TURN_SERVER_URL=turn:relay.metered.ca:80,turn:relay.metered.ca:443?transport=tcp
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=

# Supabase Client Credentials (Public Anon Key ONLY)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Install & Run Locally

In **Terminal 1** (Server):
```bash
cd server
npm install
npm run dev
```

In **Terminal 2** (Client):
```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173` in Google Chrome or Microsoft Edge.

---

## Production Deployment Guide

### Deploying the Server to Render (Free Tier)
1. Push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** > **Web Service**.
3. Connect your repository.
4. Set the following build settings:
   - **Root Directory:** `server`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node src/server.js`
   - **Plan:** Free
5. Add the Environment Variables under **Environment**:
   - `PORT`: `5000` (or leave default assigned by Render)
   - `CLIENT_URL`: `https://your-app.vercel.app` (your Vercel client URL)
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role secret
   - `GEMINI_API_KEY`: Your Google AI Studio Gemini API key
   - `GEMINI_MODEL`: `gemini-2.5-flash`
6. Click **Create Web Service**. Note your Render URL (e.g. `https://callmind-server.onrender.com`).

> **Cold Start Handling:** Render's free tier spins down after 15 minutes of inactivity. CallMind includes an automated `ServerColdStartBanner` and background keep-alive polling every 10 minutes to maintain active server availability.

---

### Deploying the Client to Vercel (Free Tier)
1. In the [Vercel Dashboard](https://vercel.com), click **Add New** > **Project**.
2. Select your repository.
3. Configure project settings:
   - **Root Directory:** Click edit and select `client`.
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Add the Environment Variables:
   - `VITE_SERVER_URL`: `https://callmind-server.onrender.com` (your Render server URL)
   - `VITE_SUPABASE_URL`: `https://your-project.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: Your public Supabase anon key
   - `VITE_ICE_SERVERS`: `stun:stun.l.google.com:19302`
   - `VITE_TURN_SERVER_URL`: `turn:relay.metered.ca:80,turn:relay.metered.ca:443?transport=tcp`
   - `VITE_TURN_USERNAME`: Your Metered.ca username
   - `VITE_TURN_CREDENTIAL`: Your Metered.ca credential
5. Deploy. Vercel routes are automatically handled by the included [`vercel.json`](file:///c:/Users/Praveen%20Kumar/OneDrive/Desktop/Voip/client/vercel.json) rewrite rule so refreshing `/call/:roomCode` or `/summary/:callId` works without 404 errors.

---

## College Viva Guide: Mapping Features to Core VoIP Concepts

| VoIP / Telephony Concept | Traditional Protocol / Standard | How CallMind Implements It |
|---|---|---|
| **Call Signaling & Session Control** | **SIP (RFC 3261)** (`INVITE`, `200 OK`, `ACK`, `BYE`) | **Socket.io WebSocket events:** `join-room` acts as `INVITE`, `offer` & `answer` negotiate session parameters (SDP), and `leave` acts as a SIP `BYE` message. |
| **Session Description & Negotiation** | **SDP (RFC 4566)** | Native WebRTC SDP Offer/Answer exchange (`pc.createOffer()`, `pc.createAnswer()`, `setLocalDescription()`, `setRemoteDescription()`). Exchanges audio codec (Opus), sample rates, and ICE candidates. |
| **Media Transport & Encryption** | **RTP (RFC 3550)** & **SRTP (RFC 3711)** | WebRTC automatically transmits audio over Secure Real-time Transport Protocol (SRTP) using UDP, encrypted with DTLS. |
| **Quality of Service (QoS) Telemetry** | **RTCP (RFC 3550)** (Sender & Receiver Reports) | Polled every 1s using `RTCPeerConnection.getStats()`. Extracts receiver reports (`inbound-rtp`) directly from the browser's RTP stack. |
| **Jitter & Packet Delay Variation** | **RFC 3550 Interarrival Jitter** | Monitored in real-time in milliseconds. High jitter indicates network congestion or buffer queueing. Compensated for in WebRTC by an internal adaptive jitter buffer. |
| **Packet Loss & Concealment** | **UDP Packet Loss** | Tracked via `(packetsLost / (packetsLost + packetsReceived)) * 100`. Demonstrates how UDP prioritizes low latency over reliability, leaving concealment to the Opus PLC (Packet Loss Concealment) algorithm. |
| **Perceived Audio Quality (MOS)** | **ITU-T G.107 E-Model** | Calculates Transmission Rating Factor $R$ from network latency ($d = \text{RTT}/2 + 2 \times \text{Jitter}$) and packet loss penalties, converting $R$ to a 1.0–5.0 Mean Opinion Score (MOS). |
| **NAT Traversal & Firewall Bypassing** | **ICE (RFC 8445)**, **STUN (RFC 5389)**, **TURN (RFC 5766)** | Generates host, server-reflexive (via Google STUN), and relay candidates (via Metered.ca TURN). Enables media exchange across symmetric NATs, university proxies, and cellular firewalls. |
| **Out-of-Band Data Exchange** | **SCTP over DTLS (RFC 8831)** | WebRTC `RTCDataChannel("transcript")` streams text and call IDs directly between peers without loading the central server. |

---

## Security Architecture

- **No Secrets on Client:** The Supabase `service_role` secret and Google Gemini API key exist strictly on the Render Node.js server.
- **Client-Side RLS:** The client communicates with Supabase strictly using the public `anon` key, authenticated via Supabase JWTs with Postgres Row-Level Security (RLS) policies.
- **P2P Audio Privacy:** Real-time voice frames never touch the Node.js server; audio is encrypted peer-to-peer using DTLS-SRTP.
- **Server Rate Limiting:** All AI intelligence endpoints are protected with sliding-window rate limiters to prevent token exhaustion.
