import { PublicLoginPage } from "../components/marketing/PublicLoginPage.tsx";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ login?: string | string[] }> }) {
  const params = await searchParams;
  return <PublicLoginPage loginRequested={params.login === "1"} />;
}
