import { redirect } from "next/navigation";

// Legacy URL kept for old links: /documents/<id> forwards to the
// feature-named /article-writer/<id>.
export default async function LegacyDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/article-writer/${id}`);
}
