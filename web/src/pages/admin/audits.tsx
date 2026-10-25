import { useQuery } from '@tanstack/react-query';
import { LucideDownload, LucideSearch } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listPlatformAudits, PlatformAuditItem } from '@/services/admin-service';

const PAGE_SIZE = 20;

/** 模块 key 白名单，用于下拉选项；未收录的 key 仍会原样显示在表格里。 */
const MODULE_KEYS = [
  'tenant',
  'user',
  'model',
  'queue',
  'sandbox',
  'config',
  'ingestor',
  'platform',
];

const ACTION_KEYS = ['create', 'update', 'delete', 'read'];

function formatTime(ms: number) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 平台审计日志。
 *
 * 后端在 admin 中间件里记录「动词 + 路由模板 + 状态码 + IP」，所以这里把
 * （模块，动词）拼成可读动作；原始 path 放在 title 里，需要排查时悬停即可看到
 * 具体调用了哪个接口。不做逐接口的中文短语映射——路由一改就会失效。
 */
export default function PlatformAuditsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [keywords, setKeywords] = useState('');
  const [module, setModule] = useState('');
  const [result, setResult] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['admin/audits', page, pageSize, keywords, module, result],
    queryFn: async () => {
      const { data } = await listPlatformAudits({
        page,
        page_size: pageSize,
        keywords,
        module,
        result,
      });
      return data?.data ?? { logs: [], total: 0 };
    },
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  const moduleLabel = useCallback(
    (key: string) => {
      if (!key) return '-';
      if (!MODULE_KEYS.includes(key)) return key;
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      return t(`admin.auditModule${cap}`, { defaultValue: key });
    },
    [t],
  );

  const actionLabel = useCallback(
    (key: string) => {
      if (!key) return '-';
      if (!ACTION_KEYS.includes(key)) return key;
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      return t(`admin.auditAction${cap}`, { defaultValue: key });
    },
    [t],
  );

  const handleExport = useCallback(() => {
    const header = [
      t('admin.auditTime'),
      t('admin.auditTenant'),
      t('admin.auditOperator'),
      t('admin.auditModule'),
      t('admin.auditAction'),
      t('admin.auditResult'),
      t('admin.auditIP'),
    ];
    const rows = logs.map((item: PlatformAuditItem) => [
      formatTime(item.create_time),
      item.tenant_name || item.tenant_id || '-',
      item.operator_name || item.operator || '-',
      moduleLabel(item.object_type),
      actionLabel(item.action),
      item.result === 'failed' ? t('admin.auditFailed') : t('admin.auditSuccess'),
      item.ip_address || '-',
    ]);
    const csv = [header, ...rows]
      .map((cols) =>
        cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
    // BOM 让 Excel 正确识别 UTF-8，否则中文列名会乱码。
    const blob = new Blob([`\ufeff${csv}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [actionLabel, logs, moduleLabel, t]);

  return (
    <section className="p-5">
      <header className="mb-4">
        <h1 className="text-2xl font-medium text-text-primary">
          {t('admin.platformAudit')}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t('admin.platformAuditSubtitle')}
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <LucideSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <Input
            value={keywords}
            onChange={(e) => {
              setKeywords(e.target.value);
              setPage(1);
            }}
            placeholder={t('admin.auditSearchPlaceholder')}
            className="w-64 pl-8"
          />
        </div>

        <select
          value={module}
          onChange={(e) => {
            setModule(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
        >
          <option value="">{t('admin.auditAllModules')}</option>
          {MODULE_KEYS.map((key) => (
            <option key={key} value={key}>
              {moduleLabel(key)}
            </option>
          ))}
        </select>

        <select
          value={result}
          onChange={(e) => {
            setResult(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
        >
          <option value="">{t('admin.auditAllResults')}</option>
          <option value="success">{t('admin.auditSuccess')}</option>
          <option value="failed">{t('admin.auditFailed')}</option>
        </select>

        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={logs.length === 0}
          >
            <LucideDownload className="mr-1 size-4" />
            {t('admin.auditExport')}
          </Button>
        </div>
      </div>

      <Table rootClassName="max-h-[calc(100vh-280px)]">
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.auditTime')}</TableHead>
            <TableHead>{t('admin.auditTenant')}</TableHead>
            <TableHead>{t('admin.auditOperator')}</TableHead>
            <TableHead>{t('admin.auditModule')}</TableHead>
            <TableHead>{t('admin.auditAction')}</TableHead>
            <TableHead>{t('admin.auditResult')}</TableHead>
            <TableHead>{t('admin.auditIP')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="py-10 text-center text-sm text-text-secondary"
              >
                {isFetching ? '…' : t('admin.auditEmpty')}
              </TableCell>
            </TableRow>
          )}
          {logs.map((item: PlatformAuditItem) => {
            const failed = item.result === 'failed';
            return (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap text-xs text-text-secondary">
                  {formatTime(item.create_time)}
                </TableCell>
                <TableCell className="text-xs">
                  {item.tenant_name || item.tenant_id ? (
                    <span
                      className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary"
                      // 名称是解析出来的，原始 id 留在 title 里方便追查。
                      title={item.tenant_id || undefined}
                    >
                      {item.tenant_name || item.tenant_id}
                    </span>
                  ) : (
                    <span className="text-text-secondary">-</span>
                  )}
                </TableCell>
                <TableCell
                  className="text-xs text-text-primary"
                  title={
                    // 显示的是解析后的名字时，把库里存的原始值挂到 tooltip 上。
                    item.operator_name && item.operator !== item.operator_name
                      ? item.operator
                      : undefined
                  }
                >
                  {item.operator_name || item.operator || '-'}
                </TableCell>
                <TableCell className="text-xs text-text-primary">
                  {moduleLabel(item.object_type)}
                </TableCell>
                <TableCell
                  className="text-xs text-text-primary"
                  title={item.path || undefined}
                >
                  {actionLabel(item.action)}
                </TableCell>
                <TableCell className="text-xs">
                  <span
                    className={
                      failed
                        ? 'rounded bg-red-50 px-1.5 py-0.5 text-red-600'
                        : 'rounded bg-green-50 px-1.5 py-0.5 text-green-700'
                    }
                  >
                    {failed
                      ? t('admin.auditFailed')
                      : t('admin.auditSuccess')}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-text-secondary">
                  {item.ip_address || '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end pt-3">
        <RAGFlowPagination
          total={total}
          current={page}
          pageSize={pageSize}
          onChange={(nextPage: number, nextPageSize: number) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
        />
      </div>
    </section>
  );
}
