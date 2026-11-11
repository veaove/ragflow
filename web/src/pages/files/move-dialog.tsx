import {
  AsyncTreeSelect,
  TreeNodeType,
} from '@/components/ui/async-tree-select';
import { ButtonLoading } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFetchPureFileList } from '@/hooks/use-file-request';
import { IModalProps } from '@/interfaces/common';
import { IFile } from '@/interfaces/database/file-manager';
import { isEmpty, uniqBy } from 'lodash';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// The picker lists the root folder's children directly, so the root itself has
// no row to select. This placeholder stands in for it and is translated to the
// real root folder id on submit.
const RootNodeId = '__root__';

export function MoveDialog({ hideModal, onOk, loading }: IModalProps<any>) {
  const { t } = useTranslation();

  const { fetchList } = useFetchPureFileList();

  const [treeValue, setTreeValue] = useState<number | string>();

  const [treeData, setTreeData] = useState<TreeNodeType[]>([]);

  const [rootFolderId, setRootFolderId] = useState<string>();

  const onLoadData = useCallback(
    async ({ id }: TreeNodeType) => {
      const ret = await fetchList({ parentId: id as string });
      if (ret.code === 0) {
        if (id === '') {
          // Listing without a parent resolves the tenant root; the root folder
          // has no row of its own, so this is where its id comes from.
          setRootFolderId(ret.data.parent_folder?.id);
        }
        setTreeData((tree) => {
          return uniqBy(
            tree.concat(
              ret.data.files
                .filter((x: IFile) => x.type === 'folder')
                .map((x: IFile) => ({
                  id: x.id,
                  parentId: x.parent_id,
                  title: x.name,
                  isLeaf:
                    typeof x.has_child_folder === 'boolean'
                      ? !x.has_child_folder
                      : false,
                })),
            ),
            'id',
          );
        });
      }
    },
    [fetchList],
  );

  // Root is a selectable target: without this row a file or folder that sits
  // inside a folder could never be moved back out.
  const treeNodes = useMemo<TreeNodeType[]>(() => {
    if (!rootFolderId) {
      return treeData;
    }
    return [
      {
        id: RootNodeId,
        parentId: '',
        title: t('fileManager.rootFolder'),
        isLeaf: true,
      },
      ...treeData,
    ];
  }, [rootFolderId, t, treeData]);

  const handleSubmit = useCallback(() => {
    onOk?.(treeValue === RootNodeId ? rootFolderId : treeValue);
  }, [onOk, rootFolderId, treeValue]);

  return (
    <Dialog open onOpenChange={hideModal}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common.move')}</DialogTitle>
        </DialogHeader>
        <div>
          <AsyncTreeSelect
            treeData={treeNodes}
            value={treeValue}
            onChange={setTreeValue}
            loadData={onLoadData}
          ></AsyncTreeSelect>
        </div>
        <DialogFooter>
          <ButtonLoading
            type="submit"
            onClick={handleSubmit}
            disabled={isEmpty(treeValue)}
            loading={loading}
          >
            {t('common.save')}
          </ButtonLoading>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
