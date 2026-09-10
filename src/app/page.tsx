import { ImpulseLanding } from "../components/marketing/ImpulseLanding.tsx";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ login?: string | string[] }> }) {
  const params = await searchParams;
  return <ImpulseLanding loginRequested={params.login === "1"} />;
}
