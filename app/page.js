"use client";
import { useState, useEffect } from "react";

// Error boundary como componente de função com estado
function ErrorBoundary({ children }) {
  const [error, setError] = useState(null);

  useEffect(() => {
    const handler = (event) => {
      setError(event.error?.message || event.message || "Erro desconhecido");
    };
    window.addEventListener("error", handler);
    window.addEventListener("unhandledrejection", (e) => setError(e.reason?.message || String(e.reason)));
    return () => window.removeEventListener("error", handler);
  }, []);

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: "monospace", background: "#fef2f2", minHeight: "100vh" }}>
        <h2 style={{ color: "#dc2626" }}>Erro capturado</h2>
        <pre style={{ background: "#fff", padding: 20, borderRadius: 8, border: "1px solid #fecaca", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {error}
        </pre>
        <button onClick={() => { setError(null); window.location.reload(); }}
          style={{ marginTop: 16, padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return children;
}

import dynamic from "next/dynamic";

const QuantitativoApp = dynamic(
  () => import("../components/QuantitativoApp"),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
          <div style={{ fontSize: 14, color: "#6b7280" }}>Carregando...</div>
        </div>
      </div>
    )
  }
);

export default function Home() {
  return (
    <ErrorBoundary>
      <QuantitativoApp />
    </ErrorBoundary>
  );
}
