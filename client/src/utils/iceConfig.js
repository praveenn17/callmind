/**
 * Resolves WebRTC ICE Servers (STUN & Metered.ca TURN) from environment variables.
 * Enables peer connections to traverse Symmetric NATs, firewalls, and cellular networks.
 */
export const getIceServerConfig = () => {
  // 1. Optional raw JSON format from Metered API if provided
  const rawJson = import.meta.env.VITE_ICE_SERVERS_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        return { iceServers: parsed };
      }
    } catch (e) {
      console.warn("[WebRTC] Could not parse VITE_ICE_SERVERS_JSON:", e);
    }
  }

  const iceServers = [];

  // 2. STUN Server (default to Google's public STUN)
  const rawStun =
    import.meta.env.VITE_ICE_SERVERS || "stun:stun.l.google.com:19302";
  const stunUrls = rawStun
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  // 3. Metered.ca TURN Server Credentials
  const turnUrlsRaw = import.meta.env.VITE_TURN_SERVER_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrlsRaw && turnUsername && turnCredential) {
    const turnUrls = turnUrlsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return { iceServers };
};
