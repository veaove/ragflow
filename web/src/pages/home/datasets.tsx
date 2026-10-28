import { CardSineLineContainer } from '@/components/card-singleline-container';
import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import { HomeIcon } from '@/components/svg-icon';
import { CardSkeleton } from '@/components/ui/skeleton';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useFetchNextKnowledgeListByPage } from '@/hooks/use-knowledge-request';
import { useTranslation } from 'react-i18next';
import { DatasetCard } from '../datasets/dataset-card';
import { DatasetEditDialog } from '../datasets/dataset-edit-dialog';
import { useEditDataset } from '../datasets/use-edit-dataset';
import { SeeAllAppCard } from './application-card';

export function Datasets() {
  const { t } = useTranslation();
  const { kbs, loading } = useFetchNextKnowledgeListByPage();
  const {
    datasetEditLoading,
    initialDatasetName,
    initialDatasetDescription,
    initialDatasetCategory,
    onDatasetEditOk,
    datasetEditVisible,
    hideDatasetEditModal,
    showDatasetEditModal,
  } = useEditDataset();
  const { navigateToDatasetList } = useNavigatePage();

  return (
    <section>
      <header>
        <h2 className="leading-8 text-2xl font-semibold mb-2.5">
          {/* <IconFont name="data" className="size-8"></IconFont> */}
          <HomeIcon imgClass="me-2.5" name="datasets" width={24} />
          {t('header.dataset')}
        </h2>
      </header>

      <div>
        {loading ? (
          <div className="flex-1">
            <CardSkeleton />
          </div>
        ) : (
          <>
            {kbs?.length > 0 && (
              <CardSineLineContainer>
                {kbs?.slice(0, 6).map((dataset) => (
                  <DatasetCard
                    key={dataset.id}
                    dataset={dataset}
                    showDatasetEditModal={showDatasetEditModal}
                  ></DatasetCard>
                ))}
                {
                  <SeeAllAppCard
                    click={() => navigateToDatasetList({ isCreate: false })}
                  ></SeeAllAppCard>
                }
              </CardSineLineContainer>
            )}
            {!(kbs && kbs?.length > 0) && (
              <div className="w-[210px]">
                <EmptyAppCard
                  type={EmptyCardType.Dataset}
                  onClick={() => navigateToDatasetList({ isCreate: true })}
                />
              </div>
            )}
          </>
          // </div>
        )}
      </div>

      {datasetEditVisible && (
        <DatasetEditDialog
          hideModal={hideDatasetEditModal}
          onOk={onDatasetEditOk}
          initialName={initialDatasetName}
          initialDescription={initialDatasetDescription}
          initialCategory={initialDatasetCategory}
          loading={datasetEditLoading}
        />
      )}
    </section>
  );
}
