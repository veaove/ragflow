import { fireEvent, render } from '@testing-library/react';

import MindMapSheet from './mindmap-sheet';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./hooks', () => ({
  usePendingMindMap: () => 0,
}));

jest.mock('@/components/indented-tree/indented-tree', () => ({
  IndentedTree: () => <div data-testid="indented-tree" />,
}));

const data = { name: 'root', children: [{ name: 'child' }] };

const renderSheet = () =>
  render(
    <MindMapSheet
      visible
      data={data}
      loading={false}
      hideModal={jest.fn()}
    />,
  );

const sheetContent = () =>
  document.querySelector('[role="dialog"]') as HTMLElement;

describe('MindMapSheet maximize', () => {
  test('opens in the narrow side panel', () => {
    renderSheet();

    expect(sheetContent()).not.toBeNull();
    expect(sheetContent().className).not.toContain('w-screen');
  });

  test('expands the panel to the full page and restores it', () => {
    renderSheet();

    fireEvent.click(
      document.querySelector('[aria-label="common.maximize"]') as HTMLElement,
    );
    expect(sheetContent().className).toContain('w-screen');
    expect(sheetContent().className).toContain('max-w-none');

    fireEvent.click(
      document.querySelector('[aria-label="common.restore"]') as HTMLElement,
    );
    expect(sheetContent().className).not.toContain('w-screen');
  });

  test('resets to the narrow panel after closing', () => {
    const { rerender } = renderSheet();

    fireEvent.click(
      document.querySelector('[aria-label="common.maximize"]') as HTMLElement,
    );
    expect(sheetContent().className).toContain('w-screen');

    rerender(
      <MindMapSheet
        visible={false}
        data={data}
        loading={false}
        hideModal={jest.fn()}
      />,
    );
    rerender(
      <MindMapSheet
        visible
        data={data}
        loading={false}
        hideModal={jest.fn()}
      />,
    );

    expect(sheetContent().className).not.toContain('w-screen');
  });
});
