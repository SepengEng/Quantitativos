import dynamic from "next/dynamic";

const QuantitativoApp = dynamic(
  () => import("../components/QuantitativoApp"),
  { ssr: false }
);

export default function Home() {
  return <QuantitativoApp />;
}
