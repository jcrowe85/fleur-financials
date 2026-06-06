import { AutoRefresh } from "@/components/AutoRefresh";
import { MetaSection } from "@/components/meta/MetaSection";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ mp?: string }>;
}

export default async function MetaPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AutoRefresh />
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <MetaSection mp={params.mp} heading />
      </div>
    </div>
  );
}
