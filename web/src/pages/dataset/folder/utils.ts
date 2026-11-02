import { IDocumentFolder } from '@/interfaces/database/document';

/** 根目录用空串表示：后端 document.folder_id 为 NULL 即"未分类"。 */
export const ROOT_FOLDER = '';

export interface FolderTreeNode extends IDocumentFolder {
  children: FolderTreeNode[];
}

/** 扁平目录列表 → 树。同级按名称排序，文件夹永远在文件前面由调用方保证。 */
export const buildFolderTree = (
  folders: IDocumentFolder[],
): FolderTreeNode[] => {
  const nodes = new Map<string, FolderTreeNode>();
  folders.forEach((folder) => nodes.set(folder.id, { ...folder, children: [] }));

  const roots: FolderTreeNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortLevel = (list: FolderTreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    list.forEach((node) => sortLevel(node.children));
  };
  sortLevel(roots);
  return roots;
};

/** 根 → 当前目录的路径，用于面包屑。 */
export const folderChain = (
  folders: IDocumentFolder[],
  folderId: string,
): IDocumentFolder[] => {
  const byID = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: IDocumentFolder[] = [];
  let current = folderId ? byID.get(folderId) : undefined;
  while (current) {
    chain.unshift(current);
    current = current.parent_id ? byID.get(current.parent_id) : undefined;
  }
  return chain;
};

/** 某一层的直接子目录。 */
export const childFoldersOf = (
  folders: IDocumentFolder[],
  parentId: string,
): IDocumentFolder[] =>
  folders
    .filter((folder) => folder.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

/** 包含自己的整棵子树 id，用于"不能移动到自己的子孙里"的前端校验。 */
export const descendantFolderIds = (
  folders: IDocumentFolder[],
  folderId: string,
): string[] => {
  const children = new Map<string, string[]>();
  folders.forEach((folder) => {
    const list = children.get(folder.parent_id) ?? [];
    list.push(folder.id);
    children.set(folder.parent_id, list);
  });
  const result: string[] = [];
  const stack = [folderId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    result.push(current);
    stack.push(...(children.get(current) ?? []));
  }
  return result;
};

/** 目录的完整路径文本，如「投教材料 › 2026」。 */
export const folderPathLabel = (
  folders: IDocumentFolder[],
  folderId: string,
): string =>
  folderChain(folders, folderId)
    .map((folder) => folder.name)
    .join(' › ');
