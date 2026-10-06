import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, buttonClass } from './Button';

describe('Button', () => {
  it('renders the .btn classes for its variant and size', () => {
    render(<Button variant="acc" size="sm" className="mt-2">Spara</Button>);
    expect(screen.getByRole('button', { name: 'Spara' }).className).toBe('btn btn-acc btn-sm mt-2');
  });

  it('the default variant is the plain ink .btn', () => {
    expect(buttonClass()).toBe('btn');
    expect(buttonClass({ variant: 'danger-ghost' })).toBe('btn btn-danger-ghost');
  });

  it('leaves type to the call site, so a button in a form still submits', () => {
    render(<form><Button>Skicka</Button><Button type="button">Avbryt</Button></form>);
    expect(screen.getByRole('button', { name: 'Skicka' })).not.toHaveAttribute('type');
    expect(screen.getByRole('button', { name: 'Avbryt' })).toHaveAttribute('type', 'button');
  });
});
