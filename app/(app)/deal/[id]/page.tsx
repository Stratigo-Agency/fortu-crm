import { Suspense } from "react";
import { DealView } from "../DealView";

// A deal on its own page: phones, shared links, and "new".
export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealView id={id} variant="page" />;
}
