import { DocumentEditor } from "./editor";

export const metadata = { title: "Article Writer" };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentEditor documentId={id} />;
}
