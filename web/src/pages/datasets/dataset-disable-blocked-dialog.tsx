import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  IDataset,
  IDatasetReference,
  IDatasetReferenceKind,
} from '@/interfaces/database/dataset';

const KIND_LABEL: Record<IDatasetReferenceKind, string> = {
  chat: '聊天 / 搜索应用',
  agent: '智能体应用',
  evaluation: '评估集',
};

// Agent references carry the canvas category so the dialog can name the exact
// app type instead of a generic "agent".
const CANVAS_CATEGORY_LABEL: Record<string, string> = {
  agent_canvas: '智能体',
  chatflow_canvas: 'Chatflow',
  workflow_canvas: '工作流',
  dataflow_canvas: '数据流',
};

function referenceKindLabel(reference: IDatasetReference) {
  if (reference.kind === 'agent' && reference.category) {
    return CANVAS_CATEGORY_LABEL[reference.category] ?? KIND_LABEL.agent;
  }
  return KIND_LABEL[reference.kind] ?? '其他应用';
}

type DatasetDisableBlockedDialogProps = {
  dataset: IDataset;
  references: IDatasetReference[];
  onClose: () => void;
};

/**
 * Explains why a dataset cannot be disabled and names every app that still
 * binds it. Disabling a referenced dataset would silently remove its content
 * from that app's retrieval, so the user has to unbind it there first.
 */
export function DatasetDisableBlockedDialog({
  dataset,
  references,
  onClose,
}: DatasetDisableBlockedDialogProps) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]" data-testid="dataset-disable-blocked">
        <DialogHeader>
          <DialogTitle>无法禁用「{dataset.name || '该知识库'}」</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-text-secondary">
          该知识库仍被以下 {references.length} 个应用引用。请先在对应应用中解绑，
          解绑后即可禁用。
        </p>

        <ul className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
          {references.map((reference) => (
            <li
              key={`${reference.kind}-${reference.id}`}
              className="flex items-center justify-between gap-3 rounded-md bg-bg-card px-3 py-2 text-sm"
            >
              <span className="truncate text-text-primary">
                {reference.name || reference.id}
              </span>
              <span className="shrink-0 text-xs text-text-secondary">
                {referenceKindLabel(reference)}
              </span>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
