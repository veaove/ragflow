import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTestRetrieval } from '@/hooks/use-knowledge-request';
import { t } from 'i18next';
import { useState } from 'react';
import { useParams } from 'react-router';
import TestingForm from './testing-form';
import { TestingResult } from './testing-result';

export default function RetrievalTesting() {
  const { loading, setValues, refetch, data, handleFilterSubmit, filterValue } =
    useTestRetrieval();

  // React Router keeps this component mounted when only the `:id` param
  // changes, but the form's persisted settings are per dataset — keying by id
  // forces a remount so switching datasets restores that dataset's own setup
  // instead of carrying the previous one over.
  const { id } = useParams();

  const [count] = useState(1); // TODO: Different layouts are needed; if they are no longer required, consider deleting them.

  return (
    <div className="pr-5 pb-5">
      <Card className="size-full bg-transparent shadow-none flex flex-col">
        <CardHeader className="p-5 border-b-0.5 border-border-button">
          <header>
            <CardTitle as="h1">
              {t('knowledgeDetails.retrievalTesting')}
            </CardTitle>

            <CardDescription>
              {t('knowledgeDetails.testingDescription')}
            </CardDescription>
          </header>
        </CardHeader>

        {count === 1 ? (
          <CardContent className="flex-1 overflow-hidden p-0 grid grid-rows-1 grid-cols-2 divide-x-0.5">
            <article className="size-full flex-1 flex flex-col">
              <header className="px-5 py-3">
                <h2 className="font-semibold text-base leading-8">
                  {t('knowledgeDetails.testSetting')}
                </h2>
              </header>

              <div className="flex-1 h-0">
                <TestingForm
                  key={id}
                  loading={loading}
                  setValues={setValues}
                  refetch={refetch}
                />
              </div>
            </article>

            <div className="flex-1">
              <TestingResult
                data={data}
                loading={loading}
                filterValue={filterValue}
                handleFilterSubmit={handleFilterSubmit}
              />
            </div>
          </CardContent>
        ) : (
          <CardContent className="p-0 flex gap-2">
            <div className="flex-1">
              <TestingForm
                key={id}
                loading={loading}
                setValues={setValues}
                refetch={refetch}
              ></TestingForm>
              <TestingResult
                data={data}
                loading={loading}
                filterValue={filterValue}
                handleFilterSubmit={handleFilterSubmit}
              ></TestingResult>
            </div>
            <div className="flex-1">
              <TestingForm
                key={id}
                loading={loading}
                setValues={setValues}
                refetch={refetch}
              ></TestingForm>
              <TestingResult
                data={data}
                loading={loading}
                filterValue={filterValue}
                handleFilterSubmit={handleFilterSubmit}
              ></TestingResult>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
