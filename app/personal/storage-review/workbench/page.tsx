import Link from 'next/link';
import StorageReviewWorkspaceEntry from '../../../../src/storage-review/workspace-entry';

export const dynamic = 'force-dynamic';
export const metadata = {title:'LifeOS · 存储审核',robots:{index:false,follow:false,archive:false}};

export default function Page() {
  return <main className="mx-auto max-w-6xl p-4 sm:p-6">
    <Link href="/personal/storage-review">返回存储审核独立入口</Link>
    <h1 className="mb-4 text-2xl font-semibold">存储审核</h1>
    <StorageReviewWorkspaceEntry/>
  </main>;
}
