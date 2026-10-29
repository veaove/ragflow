import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { RAGFlowPagination } from '../ragflow-pagination';

// The size changer renders its options through `t('pagination.page')`, so
// without an instance every option would read "pagination.page" and there would
// be no way to click the "100" one.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: 'zh',
    resources: {
      zh: {
        translation: {
          pagination: {
            total: '共 {{total}} 条',
            page: '{{page}}条/页',
            previous: '上一页',
            next: '下一页',
            more: '更多',
          },
        },
      },
    },
  });
});

// jsdom does not provide these, but the popover's command list needs them.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

/** Page buttons currently rendered, e.g. [1, 2, 3]. Page numbers are <a>. */
const pageButtons = () =>
  screen
    .queryAllByRole('link')
    .map((el) => el.textContent?.trim() ?? '')
    .filter((text) => /^\d+$/.test(text));

const pickSize = async (label: string) => {
  // The trigger is the only button showing a page-size label.
  fireEvent.click(screen.getByText('20条/页'));
  const option = await screen.findByText(label);
  fireEvent.click(option);
};

describe('RAGFlowPagination page size', () => {
  it('reports the picked size as the second argument of onChange', async () => {
    const onChange = jest.fn();
    render(
      <RAGFlowPagination
        current={1}
        pageSize={20}
        total={250}
        onChange={onChange}
      />,
    );

    await pickSize('100条/页');

    // The parent only learns about the new size through this argument; dropping
    // it (the old `onChange={(page) => setPage(page)}` call sites) made the
    // selector repaint itself while the list stayed at 20 rows.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(1, 100));
  });

  it('recomputes the page count from the picked size, even before the parent re-renders', async () => {
    // 250 rows at 20/page = 13 pages, at 100/page = 3. This render never
    // receives a new `pageSize` prop, which is exactly the moment a parent that
    // ignores the size argument used to leave the pager showing 13 pages.
    render(<RAGFlowPagination current={1} pageSize={20} total={250} />);

    expect(pageButtons().at(-1)).toBe('13');

    await pickSize('100条/页');

    await waitFor(() => expect(pageButtons().at(-1)).toBe('3'));
  });

  it('keeps the page count on the `pageSize` prop when the size changer is not used', () => {
    render(<RAGFlowPagination current={2} pageSize={20} total={250} />);

    expect(pageButtons().at(-1)).toBe('13');
    expect(screen.getByText('20条/页')).toBeTruthy();
  });
});
