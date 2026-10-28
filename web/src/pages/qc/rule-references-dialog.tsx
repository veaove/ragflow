import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getQcRuleReferences,
  type IQcRule,
  type IQcRuleReference,
} from '@/services/qc-service';

const APP_TYPE_LABEL: Record<string, string> = {
  chat: '聊天应用',
  agent: '智能体',
  canvas: '对话流',
};

/**
 * 「查看引用」弹窗：列出引用某条质检规则的所有应用。
 *
 * 引用关系来自 qc_rule_binding（规则的 home app 只是归属，不等于引用），
 * 所以这里展示的数目才是规则「实际生效范围」。应用被删除后绑定行仍在，
 * 用 missing 标记出来，便于清理悬空引用。
 */
export function RuleReferencesDialog({
  rule,
  onClose,
}: {
  rule: IQcRule | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [refs, setRefs] = useState<IQcRuleReference[]>([]);

  useEffect(() => {
    if (!rule) {
      setRefs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getQcRuleReferences(rule.id)
      .then((res) => {
        if (cancelled) return;
        const list = (
          res?.data as { data?: { references?: IQcRuleReference[] } }
        )?.data?.references;
        setRefs(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setRefs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rule]);

  const formatTime = (ts: number) => {
    if (!ts) return '-';
    // 绑定表存的是 UnixMilli；兼容秒级历史数据。
    const ms = ts > 1e12 ? ts : ts * 1000;
    return dayjs(ms).format('YYYY-MM-DD HH:mm:ss');
  };

  return (
    <Dialog open={!!rule} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>引用「{rule?.name ?? ''}」的应用</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" />
            加载中…
          </div>
        ) : refs.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-secondary">
            尚未被任何应用引用
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table scroll="page">
              <TableHeader>
                <TableRow>
                  <TableHead>应用名称</TableHead>
                  <TableHead>应用类型</TableHead>
                  <TableHead>引用时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refs.map((ref) => (
                  <TableRow key={`${ref.app_type}:${ref.app_id}`}>
                    <TableCell>
                      <span className="text-text-primary">
                        {ref.app_name || '（未知应用）'}
                      </span>
                      {ref.missing ? (
                        <span className="ml-2 text-xs text-state-error">
                          应用已删除
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {APP_TYPE_LABEL[ref.app_type] ?? ref.app_type}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {formatTime(ref.create_time)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="pt-1 text-xs text-text-secondary">
          共 {refs.length} 个应用引用此规则
        </div>
      </DialogContent>
    </Dialog>
  );
}
