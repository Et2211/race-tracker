import { Suspense } from "react";
import { SessionDashboard } from "@/components/dashboard";

async function SessionFromParams({ params, searchParams }: PageProps<"/session/[key]">) {
  const { key } = await params;
  const { t } = await searchParams;
  const at = typeof t === "string" && !Number.isNaN(Date.parse(t)) ? Date.parse(t) : null;
  return <SessionDashboard key={key} sessionKey={Number(key)} initialTime={at} />;
}

export default function Page(props: PageProps<"/session/[key]">) {
  return (
    <Suspense fallback={<div className="page"><p className="note">Loading…</p></div>}>
      <SessionFromParams {...props} />
    </Suspense>
  );
}
