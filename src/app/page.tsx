import { StartLanding } from "../components/marketing/StartLanding.tsx";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ login?: string | string[] }> }) {
  const params = await searchParams;
  return <StartLanding loginRequested={params.login === "1"} />;
}
