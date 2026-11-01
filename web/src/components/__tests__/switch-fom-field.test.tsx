import { Form } from '@/components/ui/form';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { SwitchFormField } from '../switch-form-field';

function Harness() {
  const form = useForm({ defaultValues: { flag: false } });
  return (
    <TooltipProvider>
      <Form {...form}>
        <SwitchFormField
          name="flag"
          label="Enable feature"
          tooltip="Explains the feature"
        />
      </Form>
    </TooltipProvider>
  );
}

function ErrorHarness() {
  const form = useForm({ defaultValues: { flag: false } });
  useEffect(() => {
    form.setError('flag', { type: 'required', message: 'Flag is required' });
  }, [form]);
  return (
    <TooltipProvider>
      <Form {...form}>
        <SwitchFormField name="flag" label="Enable feature" />
      </Form>
    </TooltipProvider>
  );
}

describe('SwitchFormField', () => {
  it('keeps the switch independent of the label row', () => {
    render(<Harness />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('data-state', 'unchecked');

    // components/ui/switch.tsx 有意自己持有 id：FormLabel 的 htmlFor 指向
    // form item，不会联动到开关，避免点整行 label 就把开关翻掉。
    fireEvent.click(screen.getByText('Enable feature'));
    expect(switchEl).toHaveAttribute('data-state', 'unchecked');

    // 只有直接点开关才切换。
    fireEvent.click(switchEl);
    expect(switchEl).toHaveAttribute('data-state', 'checked');
  });

  it('does not toggle the switch when the tooltip icon is clicked', () => {
    const { container } = render(<Harness />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('data-state', 'unchecked');

    const icon = container.querySelector('svg.lucide');
    expect(icon).not.toBeNull();
    fireEvent.click(icon!);

    expect(switchEl).toHaveAttribute('data-state', 'unchecked');
  });

  it('renders the field error message', () => {
    render(<ErrorHarness />);

    expect(screen.getByText('Flag is required')).toBeInTheDocument();
  });
});
