import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import ServerColdStartBanner from "./components/ServerColdStartBanner";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import CallRoom from "./pages/CallRoom";
import CallSummary from "./pages/CallSummary";
import AskCalls from "./pages/AskCalls";

export default function App() {
  return (
    <AuthProvider>
      {/* Background health monitoring & Render cold-start helper */}
      <ServerColdStartBanner />

      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Protected Routes (Requires Supabase Auth) */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/ask" element={<AskCalls />} />
          <Route path="/call/:roomCode" element={<CallRoom />} />
          <Route path="/summary/:callId" element={<CallSummary />} />
        </Route>

        {/* Fallback route */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
