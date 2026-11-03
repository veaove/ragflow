import { fireEvent, render, screen } from '@testing-library/react';

import ChunkMethodLearnMore from './chunk-method-learn-more';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./category-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="category-panel" />,
}));

const panel = () => document.querySelector('article') as HTMLElement;

const openPanel = () => {
  render(<ChunkMethodLearnMore parserId="parser-1" />);
  fireEvent.click(screen.getByText('knowledgeDetails.learnMore'));
};

describe('ChunkMethodLearnMore maximize', () => {
  test('opens inline in the narrow column', () => {
    openPanel();

    expect(panel()).not.toBeNull();
    expect(panel().className).not.toContain('fixed');
  });

  test('maximizes over the page and restores', () => {
    openPanel();

    fireEvent.click(
      document.querySelector('[aria-label="common.maximize"]') as HTMLElement,
    );
    expect(panel().className).toContain('fixed');
    expect(panel().className).toContain('inset-4');

    fireEvent.click(
      document.querySelector('[aria-label="common.restore"]') as HTMLElement,
    );
    expect(panel().className).not.toContain('fixed');
  });

  test('clicking the backdrop restores the inline panel', () => {
    openPanel();

    fireEvent.click(
      document.querySelector('[aria-label="common.maximize"]') as HTMLElement,
    );
    const backdrop = document.querySelector(
      'div.fixed.inset-0.z-40',
    ) as HTMLElement;
    expect(backdrop).not.toBeNull();

    fireEvent.click(backdrop);
    expect(panel().className).not.toContain('fixed');
  });
});
