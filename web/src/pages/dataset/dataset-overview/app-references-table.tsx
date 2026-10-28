import { EmptyType } from '@/components/empty/constant';
import Empty from '@/components/empty/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchDatasetReferences } from '@/hooks/use-knowledge-request';
import { IDatasetReference } from '@/interfaces/database/dataset';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  appReferenceName,
  appReferenceRoute,
  appReferenceTypeKey,
} from './app-references';
import { DatasetOverviewKeys } from './utils';

/**
 * Lists the apps that hold this dataset: knowledge Q&A, knowledge search,
 * agents and evaluation sets. The list is what the disable guard checks, so
 * this tab is the place to see why a dataset cannot be turned off.
 */
const AppReferencesTable = ({ datasetId }: { datasetId: string }) => {
  const { t } = useTranslation();

  const { data: references = [], isFetching } = useQuery<IDatasetReference[]>({
    queryKey: DatasetOverviewKeys.references(datasetId),
    enabled: !!datasetId,
    // Bindings change as soon as someone edits an app elsewhere, so always
    // re-read on entry instead of trusting a cached copy.
    refetchOnMount: 'always',
    queryFn: () => fetchDatasetReferences(datasetId),
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Table rootClassName="max-h-[calc(100vh-380px)] mb-4">
        <TableHeader>
          <TableRow>
            <TableHead>{t('knowledgeDetails.appName')}</TableHead>
            <TableHead className="w-48">
              {t('knowledgeDetails.appType')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {references.length > 0 ? (
            references.map((reference) => {
              const route = appReferenceRoute(reference);
              const name = appReferenceName(reference);

              return (
                <TableRow key={`${reference.kind}-${reference.id}`}>
                  <TableCell className="text-text-primary">
                    {route ? (
                      <Link
                        to={route}
                        className="transition-colors hover:text-accent-primary hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {t(appReferenceTypeKey(reference))}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={2} className="h-24 text-center">
                {isFetching ? null : (
                  <Empty
                    type={EmptyType.Data}
                    text={t('datasetOverview.noData')}
                  />
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default AppReferencesTable;
