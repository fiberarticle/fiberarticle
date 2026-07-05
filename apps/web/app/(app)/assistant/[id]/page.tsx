import { Suspense } from "react";
import { Assistant } from "../assistant";

export const metadata = { title: "Assistant" };

export default async function AssistantChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <Assistant chatId={id} />
    </Suspense>
  );
}
