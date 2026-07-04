import { Suspense } from "react";
import { Ask } from "./ask";

export const metadata = { title: "Ask" };

export default function AskPage() {
  return (
    <Suspense>
      <Ask />
    </Suspense>
  );
}
