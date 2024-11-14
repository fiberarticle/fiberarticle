import { redirect } from "next/navigation";

// Legacy URL kept for old links: the Article Writer now lives at
// /article-writer.
export default function LegacyDocumentsPage() {
  redirect("/article-writer");
}
