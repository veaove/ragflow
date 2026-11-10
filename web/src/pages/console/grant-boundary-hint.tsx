import { Check, X } from 'lucide-react';

import { HintPopover } from './hint-popover';

/**
 * 「能不能动这份资源」只看来源，不看可见档位。
 *
 * 这张表是资源授权页里最容易踩错的一条：同样是租户管理层，改配置、删内容
 * 也只在「本部门创建的资源」上成立；可见档只决定普通成员看不看得见。
 */
type BoundaryCell = boolean | 'any' | null;

const COLUMNS = ['来源', '可见', '可改配置', '可删内容', '可删资源', '可再授权'];

const ROWS: { source: string; cells: BoundaryCell[] }[] = [
  { source: '创建者 / 租户 owner', cells: [true, true, true, true, true] },
  {
    source: '租户管理员 / 平台超管',
    cells: ['any', true, true, true, true],
  },
  {
    source: '部门管理员（本部门创建的资源）',
    cells: ['any', false, false, false, false],
  },
  { source: '显式授权 edit', cells: [true, true, true, false, false] },
  { source: '显式授权 read', cells: [true, false, false, false, false] },
  {
    source: '无授权的普通成员',
    cells: [false, null, null, null, null],
  },
];

function Yes() {
  return (
    <span className="inline-flex items-center gap-0.5 text-state-success">
      <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">可以</span>
    </span>
  );
}

function No() {
  return (
    <span className="inline-flex items-center text-state-error">
      <X className="size-3.5" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">不可以</span>
    </span>
  );
}

function Cell({ value }: { value: BoundaryCell }) {
  if (value === null) {
    return <span className="text-text-secondary">—</span>;
  }
  if (value === 'any') {
    return (
      <span className="inline-flex items-center gap-1">
        <Yes />
        <span className="text-[10px] text-text-secondary">任意档</span>
      </span>
    );
  }
  return value ? <Yes /> : <No />;
}

/** 授权页说明文字后面的黄色感叹号：悬停即可对照操作权限边界。 */
export function GrantBoundaryHint() {
  return (
    <HintPopover
      label="操作权限边界（与档次无关，只与来源有关）"
      icon="warning"
      align="start"
      contentClassName="w-[560px] max-w-[calc(100vw-2rem)]"
    >
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        同一个人能不能改配置、删内容，只看资源是谁的、授权给了谁。
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-text-secondary">
              {COLUMNS.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={
                    index === 0
                      ? 'pb-1 pr-2 text-left font-normal'
                      : 'px-1 pb-1 text-center font-normal whitespace-nowrap'
                  }
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.source} className="border-t border-border-default">
                <th
                  scope="row"
                  className="py-1.5 pr-2 text-left font-normal leading-snug text-text-primary"
                >
                  {row.source}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    key={`${row.source}-${COLUMNS[index + 1]}`}
                    className="px-1 py-1.5 text-center"
                  >
                    <Cell value={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
        「任意档」表示不受可见档位限制，管理层在任何档位下都看得见；档位只
        约束普通成员。无授权时后四列不成立，所以留空。
      </p>
    </HintPopover>
  );
}
