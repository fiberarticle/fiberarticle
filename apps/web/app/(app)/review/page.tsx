import { redirect } from "next/navigation";

// Legacy URL kept for old links: the Literature Reviewer now lives at
// /literature-reviewer.
export default function LegacyReviewPage() {
  redirect("/literature-reviewer");
}
