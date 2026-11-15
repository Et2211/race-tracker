import { Suspense } from "react";
import { LiveDashboard } from "@/components/dashboard";

async function LiveFromParams({ params }: PageProps<"/live/[key]">) {
  const { key } = await params;
  return <LiveDashboard key={key} sessionKey={Number(key)} />;
}

/** A session while it runs, from OpenF1's real-time feed. */
export default function Page(props: PageProps<"/live/[key]">) {
  return (
    <Suspense fallback={<div className="page"><p className="note">Connecting…</p></div>}>
      <LiveFromParams {...props} />
    </Suspense>
  );
}
