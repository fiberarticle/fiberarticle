import { Suspense } from "react";
import { Extract } from "./extract";

export const metadata = { title: "Extract" };

export default function ExtractPage() {
  return (
    <Suspense>
      <Extract />
    </Suspense>
  );
}
