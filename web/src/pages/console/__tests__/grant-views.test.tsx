import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GrantDetailPanel } from '../grant-detail-panel';
import { GrantDialog } from '../grant-dialog';
import { GrantTree, findGrantNode } from '../grant-tree';

jest.mock('@/services/console-service', () => ({
  ...jest.requireActual('@/services/console-service'),
  fetchGrantExceptions: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockedExceptions = require('@/services/console-service')
  .fetchGrantExceptions as jest.Mock;

/**
 * 库节点：1 个成员授权 + 1 个一级目录，目录本身没有规则。
 *
 * 这里不写类型标注：测试文件的 transform 只做模块改写，TS 类型标注里的
 * import 绑定会和 jest.mock 冲突。
 */
const kbNode = () => ({
  id: 'kb1',
  name: '07-帮助中心',
  node_kind: 'dataset' as const,
  grant_kind: 'dataset',
  supports_visibility: true,
  visibility: 'tenant_owner' as const,
  owner_name: '张伟',
  file_count: 4,
  exception_count: 1,
  summary: { tone: 'exception' as const, label: '1 项例外' },
  grants: [
    {
      kind: 'user' as const,
      id: 'u1',
      name: '张伟',
      permission: 'read' as const,
      effect: 'allow' as const,
    },
  ],
  children: [
    {
      id: 'f1',
      name: '银行资料',
      node_kind: 'folder' as const,
      parent_grant_id: 'kb1',
      supports_visibility: false,
      file_count: 3,
      exception_count: 0,
      summary: { tone: 'inherit' as const, label: '继承上级' },
      grants: [] as never[],
      children: [] as never[],
    },
  ],
});

const renderWithQuery = (ui: React.ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
};

beforeEach(() => {
  mockedExceptions.mockReset();
  mockedExceptions.mockResolvedValue({
    data: { data: { items: [], total: 0, file_total: 4, exception_total: 0 } },
  });
});

describe('GrantTree', () => {
  it('渲染每层的文件数与摘要徽章，点文件夹切换右侧详情', () => {
    const onSelect = jest.fn();
    render(
      <GrantTree
        nodes={[kbNode()]}
        selectedId="kb1"
        onSelect={onSelect}
        emptyText="没有资源"
      />,
    );

    expect(screen.getByText('07-帮助中心')).toBeInTheDocument();
    expect(screen.getByText('1 项例外')).toBeInTheDocument();
    // 库是 4 个文件、目录是 3 个，各自显示在自己那行。
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    fireEvent.click(screen.getByText('银行资料'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' }),
    );
  });

  it('选中态只落在被点的那一行', () => {
    render(
      <GrantTree
        nodes={[kbNode()]}
        selectedId="f1"
        onSelect={jest.fn()}
        emptyText="没有资源"
      />,
    );

    expect(screen.getByText('银行资料').closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByText('07-帮助中心').closest('button')).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('点文件夹时在子节点里找得到它，而不是回落成第一个库', () => {
    const root = kbNode();
    expect(findGrantNode([root], 'f1')?.name).toBe('银行资料');
    expect(findGrantNode([root], 'kb1')?.name).toBe('07-帮助中心');
    expect(findGrantNode([root], 'missing')).toBeUndefined();
  });

  it('没有资源时给出空态文案', () => {
    render(
      <GrantTree
        nodes={[]}
        selectedId=""
        onSelect={jest.fn()}
        emptyText="没有匹配的资源"
      />,
    );

    expect(screen.getByText('没有匹配的资源')).toBeInTheDocument();
  });
});

describe('GrantDetailPanel', () => {
  it('列出本层授权，并说明其余文件仍在继承', async () => {
    const onRemove = jest.fn();
    renderWithQuery(
      <GrantDetailPanel
        tenantId="t1"
        kind="dataset"
        node={kbNode()}
        trail={[kbNode()]}
        onEdit={jest.fn()}
        onRemove={onRemove}
        onClearException={jest.fn()}
        onVisibilityChange={jest.fn()}
      />,
    );

    expect(screen.getByText('本层授权')).toBeInTheDocument();
    expect(screen.getByText('张伟')).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByText('全部 4 个文件都继承本层设置，没有单独例外。'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('移除'));
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dataset', resourceId: 'kb1' }),
      expect.objectContaining({ kind: 'user', id: 'u1' }),
    );
  });

  it('目录节点指回库上的授权，而不是自称有规则', () => {
    const root = kbNode();
    const folder = root.children[0];
    renderWithQuery(
      <GrantDetailPanel
        tenantId="t1"
        kind="dataset"
        node={folder}
        trail={[root, folder]}
        inheritedFrom={{ node: root, grants: root.grants }}
        onEdit={jest.fn()}
        onRemove={jest.fn()}
        onClearException={jest.fn()}
        onVisibilityChange={jest.fn()}
      />,
    );

    expect(
      screen.getByText(/文件夹不单独授权，规则落在知识库与文件上/),
    ).toBeInTheDocument();
    expect(screen.getByText(/全部继承/)).toBeInTheDocument();
  });

  it('每个例外行都带自己的规则标签，主体解析不出来时给占位而不是留白', async () => {
    mockedExceptions.mockResolvedValue({
      data: {
        data: {
          items: [
            {
              resource_id: 'd1',
              resource_name: '全触点分析产品功能说明书.docx',
              grant_kind: 'document',
              node_kind: 'file',
              parent_grant_id: 'kb1',
              path: '华夏基金 / 综合部',
              restricted: true,
              grants: [
                {
                  kind: 'user',
                  id: 'u2',
                  name: '和君测试',
                  permission: 'read',
                  effect: 'deny',
                },
              ],
            },
            {
              // 规则还在（restricted=true），但主体已经解析不出名字：
              // 之前这里整格留白，看起来像这一行渲染坏了。
              resource_id: 'd2',
              resource_name: '云客服-人机协呼-管理端操作手册.docx',
              grant_kind: 'document',
              node_kind: 'file',
              parent_grant_id: 'kb1',
              path: '华夏基金 / 产品部',
              restricted: true,
              grants: [],
            },
          ],
          total: 2,
          file_total: 4,
          exception_total: 2,
        },
      },
    });

    renderWithQuery(
      <GrantDetailPanel
        tenantId="t1"
        kind="dataset"
        node={kbNode()}
        trail={[kbNode()]}
        onEdit={jest.fn()}
        onRemove={jest.fn()}
        onClearException={jest.fn()}
        onVisibilityChange={jest.fn()}
      />,
    );

    expect(await screen.findByText('和君测试·已排除')).toBeInTheDocument();
    expect(screen.getByText('规则主体未知')).toBeInTheDocument();
    expect(
      screen.getByText('云客服-人机协呼-管理端操作手册.docx'),
    ).toBeInTheDocument();
  });
});

describe('GrantDialog', () => {
  it('文件级弹窗标出作用范围，并允许直接加拒绝', () => {
    render(
      <GrantDialog
        target={{
          kind: 'document',
          resourceId: 'd1',
          name: '招商银行对账单.pdf',
          parentId: 'kb1',
          parentName: '07-帮助中心',
          grants: [],
          defaultScope: 'inherit',
          scopeHint: '本层及全部 4 个文件；子项自己设置过的规则优先',
          initialEffect: 'deny',
        }}
        options={{ departments: [], members: [] }}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByText('设置文件可见范围')).toBeInTheDocument();
    expect(
      screen.getByText(
        '作用范围：本层及全部 4 个文件；子项自己设置过的规则优先',
      ),
    ).toBeInTheDocument();
    // 从「添加例外」进来时默认就是排除，省掉一次下拉选择。
    expect(screen.getByDisplayValue('不可见（排除）')).toBeInTheDocument();
  });

  it('知识库弹窗支持「不可见（排除）」，且能看出这是资源级', () => {
    render(
      <GrantDialog
        target={{
          kind: 'dataset',
          resourceId: 'kb1',
          name: '07-帮助中心',
          grants: [
            { kind: 'team', id: '', name: '全团队', permission: 'edit' },
            {
              kind: 'user',
              id: 'u2',
              name: '李四',
              permission: 'read',
              effect: 'deny',
            },
          ],
          defaultScope: 'owner',
          supportsDeny: true,
        }}
        options={{ departments: [], members: [] }}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByText('设置可见范围')).toBeInTheDocument();
    // 资源级也能选「不可见（排除）」：这是「全员可见后排除个别人」的入口。
    expect(
      screen.getByRole('option', { name: '不可见（排除）' }),
    ).toBeInTheDocument();
    // 已排除的主体直接标出来，不必展开才知道。
    expect(screen.getByText('已排除')).toBeInTheDocument();
  });

  it('不支持排除的资源只给查看/编辑两档', () => {
    render(
      <GrantDialog
        target={{
          kind: 'file',
          resourceId: 'f1',
          name: '合同.pdf',
          grants: [],
          defaultScope: 'owner',
          supportsDeny: false,
        }}
        options={{ departments: [], members: [] }}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.queryByRole('option', { name: '不可见（排除）' })).toBeNull();
  });
});
