import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api";
import Shell from "./components/Shell";
import Analytics from "./pages/Analytics";
import Command from "./pages/Command";
import Detections from "./pages/Detections";
import Governance from "./pages/Governance";
import Gym from "./pages/Gym";
import Login from "./pages/Login";
import Policy from "./pages/Policy";

const Landing = lazy(() => import("./pages/Landing"));
const Brief = lazy(() => import("./pages/Brief"));

function Guard({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Suspense fallback={<div className="min-h-dvh bg-[#05060a]" />}>
            <Landing />
          </Suspense>
        }
      />
      <Route
        path="/brief"
        element={
          <Suspense fallback={<div className="min-h-dvh bg-[#05060a]" />}>
            <Brief />
          </Suspense>
        }
      />
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <Guard>
            <Shell>
              <Routes>
                <Route path="/command" element={<Command />} />
                <Route path="/detections" element={<Detections />} />
                <Route path="/gym" element={<Gym />} />
                <Route path="/policy" element={<Policy />} />
                <Route path="/governance" element={<Governance />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="*" element={<Navigate to="/command" replace />} />
              </Routes>
            </Shell>
          </Guard>
        }
      />
    </Routes>
  );
}
