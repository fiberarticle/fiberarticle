import { Suspense } from "react";
import { Extract } from "../extract";

export const metadata = { title: "Extract" };

export default async function ExtractTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <Extract tableId={id} />
    </Suspense>
  );
}
