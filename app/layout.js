export const metadata = {
  title: "Quantitativos · IA — Medição e Orçamento Automático",
  description: "Suba a planta, a IA mede tudo e gera o orçamento com SINAPI Bahia.",
};
export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, padding: 0, background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
