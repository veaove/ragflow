import { fireEvent, render, screen } from '@testing-library/react';
import { IDocumentFolder } from '@/interfaces/database/document';
import { FolderActionCell } from './folder-action-cell';

const folder: IDocumentFolder = {
  id: 'folder-1',
  parent_id: '',
  name: '操作手册',
  doc_count: 0,
  file_count: 2,
  folder_count: 0,
  created_by: 'user-1',
};

// 「解析文件夹」留在解析列，操作列只承载重命名 / 移动到 / 删除。
it('renders rename, move and delete actions and wires their handlers', () => {
  const onRename = jest.fn();
  const onMove = jest.fn();
  const onDelete = jest.fn();

  render(
    <FolderActionCell
      record={folder}
      onRename={onRename}
      onMove={onMove}
      onDelete={onDelete}
    />,
  );

  fireEvent.click(screen.getByTitle('重命名'));
  fireEvent.click(screen.getByTitle('移动到'));
  fireEvent.click(screen.getByTitle('删除'));

  expect(onRename).toHaveBeenCalledWith(folder);
  expect(onMove).toHaveBeenCalledWith(folder);
  expect(onDelete).toHaveBeenCalledWith(folder);
});

it('hides an action whose handler is not provided', () => {
  render(<FolderActionCell record={folder} onRename={jest.fn()} />);

  expect(screen.getByTitle('重命名')).toBeInTheDocument();
  expect(screen.queryByTitle('移动到')).not.toBeInTheDocument();
  expect(screen.queryByTitle('删除')).not.toBeInTheDocument();
});
