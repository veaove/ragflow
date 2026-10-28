import { HomeCard } from '@/components/home-card';
import { MoreButton } from '@/components/more-button';
import { SharedBadge } from '@/components/shared-badge';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IDataset } from '@/interfaces/database/dataset';
import { t } from 'i18next';
import { ChevronRight } from 'lucide-react';
import { DatasetDropdown } from './dataset-dropdown';
import { useEditDataset } from './use-edit-dataset';

export type DatasetCardProps = {
  dataset: IDataset;
} & Pick<ReturnType<typeof useEditDataset>, 'showDatasetEditModal'>;

export function DatasetCard({
  dataset,
  showDatasetEditModal,
}: DatasetCardProps) {
  const { navigateToDataset } = useNavigatePage();

  return (
    <HomeCard
      data={{
        ...dataset,
        description: `${dataset.document_count} ${t('knowledgeDetails.files')}`,
      }}
      moreDropdown={
        <DatasetDropdown
          showDatasetEditModal={showDatasetEditModal}
          dataset={dataset}
        >
          <MoreButton></MoreButton>
        </DatasetDropdown>
      }
      sharedBadge={<SharedBadge>{dataset.nickname}</SharedBadge>}
      onClick={navigateToDataset(dataset.id)}
    />
  );
}

export function SeeAllCard() {
  const { navigateToDatasetList } = useNavigatePage();

  return (
    <Card
      className="w-full flex-none h-full cursor-pointer"
      onClick={() => navigateToDatasetList({ isCreate: false })}
    >
      <CardContent className="p-2.5 pt-1 w-full h-full flex items-center justify-center gap-1.5 text-text-secondary">
        {t('common.seeAll')} <ChevronRight className="size-4" />
      </CardContent>
    </Card>
  );
}
