export const metadata = {
  title: "Extrator de Quantitativos",
  description: "Sistema de extração de quantitativos por IA — obras industriais",
};
export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
