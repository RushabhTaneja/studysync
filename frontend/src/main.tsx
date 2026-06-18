import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Participant } from "./pages/Participant";
import { ResearcherDashboard } from "./pages/ResearcherDashboard";
import { ParticipantDetail } from "./pages/ParticipantDetail";
import { Layout } from "./components/Layout";

function RequireRole({ role, children }: { role: "participant" | "researcher"; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={user.role === "researcher" ? "/dashboard" : "/participant"} replace />;
  return <Layout>{children}</Layout>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "researcher" ? "/dashboard" : "/participant"} replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/participant" element={<RequireRole role="participant"><Participant /></RequireRole>} />
          <Route path="/dashboard" element={<RequireRole role="researcher"><ResearcherDashboard /></RequireRole>} />
          <Route path="/dashboard/:code" element={<RequireRole role="researcher"><ParticipantDetail /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
