import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MunicipalityPicker } from './MunicipalityPicker';

function setup(value: string | null = 'Uppsala', result = true) {
  const onSelect = vi.fn(async () => result);
  const utils = render(<MunicipalityPicker value={value} onSelect={onSelect} />);
  const input = screen.getByRole('combobox', { name: 'Hemkommun' }) as HTMLInputElement;
  return { ...utils, onSelect, input };
}

describe('MunicipalityPicker', () => {
  it('visar det sparade värdet när fältet inte används', () => {
    const { input } = setup();
    expect(input.value).toBe('Uppsala');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('att skriva filtrerar listan, utan hänsyn till å/ä/ö, och Enter väljer första träffen', async () => {
    const { input, onSelect } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ostersund' } });
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Östersund']);
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(onSelect).toHaveBeenCalledWith('Östersund');
    expect(input.value).toBe('Östersund');
  });

  it('pilarna flyttar markeringen och Enter väljer den markerade', async () => {
    const { input, onSelect } = setup(null);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'borg' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = input.getAttribute('aria-activedescendant')!;
    const name = document.getElementById(active)!.textContent;
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(onSelect).toHaveBeenCalledWith(name);
  });

  it('Escape stänger och återställer det sparade värdet, utan att spara', () => {
    const { input, onSelect } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Malm' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Uppsala');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('att lämna fältet utan val återställer det sparade värdet', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Malm' } });
    fireEvent.blur(input);
    expect(input.value).toBe('Uppsala');
  });

  it('ingen träff ger ett synligt besked', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Köpenhamn' } });
    expect(screen.getByText('Inga träffar. Kontrollera stavningen.')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('en vägrad sparning visar det sparade värdet igen', async () => {
    const { input, onSelect } = setup('Uppsala', false);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Malmö' } });
    await act(async () => { fireEvent.mouseDown(screen.getByRole('option', { name: 'Malmö' })); });
    expect(onSelect).toHaveBeenCalledWith('Malmö');
    expect(input.value).toBe('Uppsala');
  });

  it('att öppna fältet visar hela listan med det sparade valet markerat', () => {
    const { input } = setup();
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(290);
    expect(screen.getByRole('option', { name: 'Uppsala' }).getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)!.textContent).toBe('Uppsala');
  });

  it('ArrowUp och ArrowDown flyttar ett steg åt gången och stannar vid listans kanter', () => {
    const { input } = setup(null);
    const activeText = () => document.getElementById(input.getAttribute('aria-activedescendant')!)!.textContent;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ström' } });
    expect(activeText()).toBe('Strömstad');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeText()).toBe('Strömsund');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeText()).toBe('Olofström');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeText()).toBe('Olofström');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeText()).toBe('Strömsund');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeText()).toBe('Strömstad');
  });

  it('att välja den kommun som redan är sparad sparar ingenting', async () => {
    const { input, onSelect } = setup('Uppsala');
    fireEvent.focus(input);
    await act(async () => { fireEvent.mouseDown(screen.getByRole('option', { name: 'Uppsala' })); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(input.value).toBe('Uppsala');
  });
});
