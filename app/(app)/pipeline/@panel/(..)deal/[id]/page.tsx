import { Suspense } from "react";
import { DealView } from "../../../../deal/DealView";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The same deal as a side panel over the Pipeline.
export default function DealPanel({ params, searchParams }: Props) {
  return (
    <Suspense>
      <Loader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Loader({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  return <DealView id={id} variant="panel" query={query} />;
}
