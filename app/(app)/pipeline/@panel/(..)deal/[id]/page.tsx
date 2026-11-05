import { Suspense } from "react";
import { DealView } from "../../../../deal/DealView";

// The same deal as a side panel over the Pipeline.
export default function DealPanel({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealView id={id} variant="panel" />;
}
