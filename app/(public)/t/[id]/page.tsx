import { PageFrame } from "@/components/layout/page-frame";
import { DownloadClient } from "@/components/download/download-client";

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageFrame>
      <DownloadClient id={id} />
    </PageFrame>
  );
}
