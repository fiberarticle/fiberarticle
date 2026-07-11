import type { Metadata } from "next";
import { Review } from "./review";

export const metadata: Metadata = {
  title: "Literature review | Fiberarticle",
};

export default function ReviewPage() {
  return <Review />;
}
