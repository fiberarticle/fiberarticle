import { Suspense } from "react";
import { Assistant } from "./assistant";

export const metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <Suspense>
      <Assistant />
    </Suspense>
  );
}
