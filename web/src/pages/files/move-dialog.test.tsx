import { fireEvent, render, screen } from '@testing-library/react';

import { MoveDialog } from './move-dialog';

const mockFetchList = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/hooks/use-file-request', () => ({
  useFetchPureFileList: () => ({ fetchList: mockFetchList }),
}));

// The real picker loads folders through a Radix popover; this stub keeps the
// load-on-mount contract and renders one button per selectable node instead.
jest.mock('@/components/ui/async-tree-select', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const MockAsyncTreeSelect = ({
    treeData,
    onChange,
    loadData,
  }: {
    treeData: { id: string; title: string }[];
    onChange: (id: string) => void;
    loadData?: (node: { id: string }) => void;
  }) => {
    React.useEffect(() => {
      loadData?.({ id: '', parentId: '', title: '' });
    }, [loadData]);
    return React.createElement(
      'div',
      null,
      treeData.map((node) =>
        React.createElement(
          'button',
          { key: node.id, type: 'button', onClick: () => onChange(node.id) },
          node.title,
        ),
      ),
    );
  };
  return { AsyncTreeSelect: MockAsyncTreeSelect };
});

jest.mock('@/components/ui/dialog', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Passthrough = ({ children }: { children?: unknown }) =>
    React.createElement('div', null, children as never);
  return {
    Dialog: Passthrough,
    DialogContent: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    DialogFooter: Passthrough,
  };
});

const rootFolderId = 'root-folder-id';

function resolveList() {
  mockFetchList.mockResolvedValue({
    code: 0,
    data: {
      parent_folder: { id: rootFolderId, parent_id: rootFolderId, name: '/' },
      files: [
        {
          id: 'folder-1',
          parent_id: rootFolderId,
          name: '催收案例',
          type: 'folder',
          has_child_folder: false,
        },
        {
          id: 'file-1',
          parent_id: rootFolderId,
          name: 'a.wav',
          type: 'file',
        },
      ],
    },
  });
}

describe('MoveDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveList();
  });

  it('offers the tenant root as a move target and submits its real folder id', async () => {
    const onOk = jest.fn();
    render(<MoveDialog hideModal={jest.fn()} onOk={onOk} />);

    fireEvent.click(await screen.findByText('fileManager.rootFolder'));
    fireEvent.click(screen.getByText('common.save'));

    expect(onOk).toHaveBeenCalledWith(rootFolderId);
  });

  it('still submits a selected folder id', async () => {
    const onOk = jest.fn();
    render(<MoveDialog hideModal={jest.fn()} onOk={onOk} />);

    fireEvent.click(await screen.findByText('催收案例'));
    fireEvent.click(screen.getByText('common.save'));

    expect(onOk).toHaveBeenCalledWith('folder-1');
  });
});
