import { Suspense } from "react";
import { DealView } from "../DealView";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A deal on its own page: phones, shared links, and "new".
export default function DealPage({ params, searchParams }: Props) {
  return (
    <Suspense>
      <Loader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Loader({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  return <DealView id={id} variant="page" query={query} />;
}
