import { IDatasetReference } from '@/interfaces/database/dataset';
import {
  appReferenceName,
  appReferenceRoute,
  appReferenceTypeKey,
} from '../app-references';

const reference = (
  overrides: Partial<IDatasetReference> = {},
): IDatasetReference => ({
  kind: 'chat',
  id: 'chat-1',
  name: '客服助手',
  ...overrides,
});

describe('dataset app references', () => {
  it('links to the detail page of every app kind that has one', () => {
    expect(appReferenceRoute(reference({ kind: 'chat', id: 'c1' }))).toBe(
      '/chat/c1',
    );
    expect(appReferenceRoute(reference({ kind: 'search', id: 's1' }))).toBe(
      '/search/s1',
    );
    expect(appReferenceRoute(reference({ kind: 'agent', id: 'a1' }))).toBe(
      '/agent/a1',
    );
    // Evaluation sets live inside their own module; a link would 404.
    expect(
      appReferenceRoute(reference({ kind: 'evaluation', id: 'e1' })),
    ).toBeUndefined();
  });

  it('names the app type, refining canvases by their category', () => {
    expect(appReferenceTypeKey(reference({ kind: 'chat' }))).toBe(
      'analytics.appTypeChat',
    );
    expect(appReferenceTypeKey(reference({ kind: 'search' }))).toBe(
      'analytics.appTypeSearch',
    );
    expect(appReferenceTypeKey(reference({ kind: 'evaluation' }))).toBe(
      'analytics.appTypeEvaluation',
    );
    expect(
      appReferenceTypeKey(
        reference({ kind: 'agent', category: 'chatflow_canvas' }),
      ),
    ).toBe('analytics.appTypeChatflow');
  });

  it('treats a canvas without a category as an agent', () => {
    expect(appReferenceTypeKey(reference({ kind: 'agent' }))).toBe(
      'analytics.appTypeAgent',
    );
    expect(
      appReferenceTypeKey(
        reference({ kind: 'agent', category: 'something_new' }),
      ),
    ).toBe('analytics.appTypeUnknown');
  });

  it('falls back to the id when a legacy reference has no name', () => {
    expect(appReferenceName(reference({ name: '' }))).toBe('chat-1');
    expect(appReferenceName(reference({ name: '客服助手' }))).toBe('客服助手');
  });
});
