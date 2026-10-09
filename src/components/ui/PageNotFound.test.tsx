import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageNotFound } from './PageNotFound';

describe('PageNotFound', () => {
  it('shows the heading and explanation', () => {
    render(<PageNotFound />);
    expect(screen.getByRole('heading', { name: 'Sidan finns inte' })).toBeInTheDocument();
    expect(screen.getByText('Länken kan vara fel, eller så har sidan flyttat.')).toBeInTheDocument();
  });

  it('has a GET search form pointing at /search/', () => {
    const { container } = render(<PageNotFound />);
    const form = container.querySelector('form')!;
    expect(form).toHaveAttribute('action', '/search/');
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByRole('searchbox', { name: 'Sök film eller serie' })).toHaveAttribute('name', 'q');
  });

  it('links to Hem, Bibliotek and Streamingpriser', () => {
    render(<PageNotFound />);
    expect(screen.getByRole('link', { name: 'Hem' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Bibliotek' })).toHaveAttribute('href', expect.stringMatching(/^\/my\/all\/?$/));
    expect(screen.getByRole('link', { name: 'Streamingpriser' })).toHaveAttribute('href', expect.stringMatching(/^\/streamingpriser\/?$/));
  });
});
