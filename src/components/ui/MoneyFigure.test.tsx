import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MoneyFigure from './MoneyFigure';

describe('MoneyFigure', () => {
  it('shows the monthly total, the yearly sum and one line per service', () => {
    render(<MoneyFigure monthlyKr={487} estimated={false} lines={[{ label: 'Viaplay', kr: 219 }, { label: 'Netflix', kr: 149 }, { label: 'Max', kr: 119 }]} />);
    const figure = screen.getByTestId('money-figure');
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['Viaplay219 kr', 'Netflix149 kr', 'Max119 kr']);
    expect(figure).toHaveTextContent(/Per månad\s*487 kr/);
    expect(figure).toHaveTextContent(/Per år\s*5 844 kr/);
    expect(figure).not.toHaveTextContent('uppskattat');
  });

  it('marks the yearly sum uppskattat when a list price is in it', () => {
    render(<MoneyFigure monthlyKr={169} estimated />);
    expect(screen.getByTestId('money-figure')).toHaveTextContent(/Per år, uppskattat\s*2 028 kr/);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
