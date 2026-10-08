import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WatchedDateEditor from './WatchedDateEditor';

const originalShowPicker = HTMLInputElement.prototype.showPicker;
afterEach(() => {
  HTMLInputElement.prototype.showPicker = originalShowPicker;
});

describe('WatchedDateEditor', () => {
  it('visar datumet på svenska, aldrig som 2026-08-28', () => {
    const watched = new Date(2024, 7, 28, 12);
    const { container } = render(<WatchedDateEditor watchedAt={watched} onChange={() => {}} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('28 aug 2024');
    // Det synliga ska inte bära ISO-formen; den finns bara i den dolda inputens värde.
    const visible = button.textContent + (container.querySelector('span')?.textContent ?? '');
    expect(visible).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('knappen öppnar datumväljaren', () => {
    const showPicker = vi.fn();
    HTMLInputElement.prototype.showPicker = showPicker;
    render(<WatchedDateEditor watchedAt={new Date(2024, 7, 28, 12)} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('utan showPicker visas inputen i stället', () => {
    HTMLInputElement.prototype.showPicker = () => { throw new Error('NotSupportedError'); };
    const { container } = render(<WatchedDateEditor watchedAt={new Date(2024, 7, 28, 12)} onChange={() => {}} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.className).toContain('sr-only');
    fireEvent.click(screen.getByRole('button'));
    expect(input.className).not.toContain('sr-only');
    expect(input.tabIndex).toBe(0);
  });

  it('ett valt datum sparas som lokal middag', () => {
    const onChange = vi.fn();
    const { container } = render(<WatchedDateEditor watchedAt={new Date(2024, 7, 28, 12)} onChange={onChange} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2024-05-03' } });
    expect(onChange).toHaveBeenCalledWith(new Date(2024, 4, 3, 12, 0, 0));
  });
});
