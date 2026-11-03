import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GrantDocumentRows } from './grant-document-rows';

// The paginator is exercised through its props: the size changer only works if
// the parent honours the new size, which is exactly what used to be broken.
const paginationProps: any = {};
jest.mock('@/components/ui/ragflow-pagination', () => ({
  RAGFlowPagination: (props: any) => {
    Object.assign(paginationProps, props);
    return (
      <button
        type="button"
        data-testid="pick-100"
        onClick={() => props.onChange(1, 100)}
      >
        100
      </button>
    );
  },
}));

jest.mock('@/services/console-service', () => ({
  fetchGrantDocuments: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchGrantDocuments } = jest.requireMock('@/services/console-service');

const renderRows = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <table>
        <tbody>
          <GrantDocumentRows
            tenantId="tenant-1"
            dataset={{
              resourceId: 'dataset-1',
              name: '知识库',
              defaultScope: 'private',
            }}
            onEdit={jest.fn()}
          />
        </tbody>
      </table>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchGrantDocuments.mockReset();
  fetchGrantDocuments.mockResolvedValue({
    data: {
      data: {
        documents: [
          {
            document_id: 'doc-1',
            document_name: '浦发银行(1).md',
            suffix: 'md',
            created_by: 'user-1',
            created_by_name: '敏',
            restricted: false,
            grants: [],
          },
        ],
        total: 44,
      },
    },
  });
});

describe('GrantDocumentRows pagination', () => {
  test('requests the expanded list with the default page size', async () => {
    renderRows();

    await waitFor(() => expect(fetchGrantDocuments).toHaveBeenCalled());
    expect(fetchGrantDocuments).toHaveBeenCalledWith('tenant-1', 'dataset-1', {
      keywords: undefined,
      page: 1,
      page_size: 10,
    });
  });

  test('follows the page size picked in the dropdown', async () => {
    renderRows();

    // The paginator only mounts once the first page has a total.
    await screen.findByText('浦发银行(1).md');
    expect(paginationProps.pageSize).toBe(10);

    fireEvent.click(screen.getByTestId('pick-100'));

    await waitFor(() => expect(fetchGrantDocuments).toHaveBeenCalledTimes(2));
    expect(fetchGrantDocuments).toHaveBeenLastCalledWith(
      'tenant-1',
      'dataset-1',
      { keywords: undefined, page: 1, page_size: 100 },
    );
    await waitFor(() => expect(paginationProps.pageSize).toBe(100));
  });

  test('wraps the expanded list in a bordered container', async () => {
    const { container } = renderRows();

    await screen.findByText('浦发银行(1).md');
    const box = container.querySelector('.rounded-lg.border');
    expect(box).not.toBeNull();
    expect(box?.className).toContain('border-border-default');
  });
});
