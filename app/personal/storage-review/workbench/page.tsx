import {StorageReviewWorkspaceFrame} from '../../../../src/personal-candidate/storage-review-frame';
import StorageReviewWorkspaceEntry from '../../../../src/storage-review/workspace-entry';

export const dynamic = 'force-dynamic';
export const metadata = {title:'LifeOS · 存储审核',robots:{index:false,follow:false,archive:false}};

export default function Page() {
  return <StorageReviewWorkspaceFrame>
    <StorageReviewWorkspaceEntry/>
  </StorageReviewWorkspaceFrame>;
}
