import { PaperView } from "./paper-view";

export const metadata = { title: "Paper" };

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaperView paperId={id} />;
}
