import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { TooltipProvider } from '@/components/ui/tooltip';
import {
  VisibilityScopeField,
  normalizeVisibility,
} from './visibility-scope-field';

const mockFetchGrantTree = jest.fn();
const mockSetGrantVisibility = jest.fn();
const mockSetGrants = jest.fn();

jest.mock('@/services/console-service', () => ({
  fetchGrantTree: (...args: unknown[]) => mockFetchGrantTree(...args),
  setGrantVisibility: (...args: unknown[]) => mockSetGrantVisibility(...args),
  setGrants: (...args: unknown[]) => mockSetGrants(...args),
}));

jest.mock('@/hooks/use-console-permissions', () => ({
  useConsolePermissions: () => ({
    canView: () => true,
    can: () => true,
    isOwner: true,
    tenantId: 'tenant-1',
  }),
}));

jest.mock('@/hooks/use-grant-subject-options', () => ({
  useGrantSubjectOptions: () => ({
    members: [],
    options: { departments: [], members: [] },
  }),
}));

jest.mock('../contexts/knowledge-base-context', () => ({
  useKnowledgeBaseContext: () => ({
    knowledgeBase: {
      id: 'kb-1',
      name: '01-关于华夏',
      tenant_id: 'tenant-1',
      permission: 'team',
    },
  }),
}));

function renderField() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <VisibilityScopeField />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('normalizeVisibility', () => {
  it('shows the stored value as one of the three tiers', () => {
    expect(normalizeVisibility('owner')).toBe('owner');
    expect(normalizeVisibility('tenant_owner')).toBe('tenant_owner');
    expect(normalizeVisibility('platform')).toBe('platform');
  });

  it('folds the legacy me/team values into the same tiers', () => {
    // 库里还留着升级前的值：直接渲染会露出生值（截图里就只剩一个 owner）。
    expect(normalizeVisibility('me')).toBe('owner');
    expect(normalizeVisibility('team')).toBe('tenant_owner');
  });

  it('falls back to owner for empty or unknown values', () => {
    expect(normalizeVisibility('')).toBe('owner');
    expect(normalizeVisibility(undefined)).toBe('owner');
    expect(normalizeVisibility('nonsense')).toBe('owner');
  });
});

describe('VisibilityScopeField', () => {
  beforeEach(() => {
    mockFetchGrantTree.mockResolvedValue({
      data: { data: { nodes: [] } },
    });
    mockSetGrantVisibility.mockResolvedValue({ data: { code: 0 } });
    mockSetGrants.mockResolvedValue({ data: { code: 0 } });
  });

  afterEach(() => jest.clearAllMocks());

  it('renders the current scope with the same wording as the grant page', () => {
    renderField();

    // team → 租户管理层可见，而不是把库里的原值摆出来。
    expect(screen.getByText('租户管理层可见')).toBeInTheDocument();
    expect(screen.getByText('设置可见范围')).toBeInTheDocument();
  });

  it('opens the same 设置可见范围 dialog as the grant page', async () => {
    renderField();

    fireEvent.click(screen.getByRole('button', { name: '设置可见范围' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('01-关于华夏')).toBeInTheDocument();
    expect(screen.getByText('开放给全团队')).toBeInTheDocument();
  });


});
