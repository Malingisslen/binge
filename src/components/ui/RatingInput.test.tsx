import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RatingInput, valueAtPosition } from './RatingInput';

const props = {
  labelFor: (n: number) => `Sett ${n}`,
  groupLabel: 'Betyg',
};

// jsdom has no layout, so give the star row a 100px-wide box.
function sizeTrack(group: HTMLElement) {
  group.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 20, height: 20, x: 0, y: 0, toJSON() {} });
}

describe('valueAtPosition', () => {
  it('maps the row to half steps from 0.5 to 5', () => {
    expect(valueAtPosition(0, 0, 100)).toBe(0.5);
    expect(valueAtPosition(9, 0, 100)).toBe(0.5);
    expect(valueAtPosition(11, 0, 100)).toBe(1);
    expect(valueAtPosition(55, 0, 100)).toBe(3);
    expect(valueAtPosition(100, 0, 100)).toBe(5);
  });

  it('clamps outside the row', () => {
    expect(valueAtPosition(-30, 0, 100)).toBe(0.5);
    expect(valueAtPosition(400, 0, 100)).toBe(5);
  });
});

describe('RatingInput', () => {
  it('offers ten buttons, one per half star', () => {
    render(<RatingInput value={0} onSelect={vi.fn()} {...props} />);
    expect(screen.getAllByRole('button')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Sett 3.5' })).toBeTruthy();
  });

  it('a click on a half star selects that half step', () => {
    const onSelect = vi.fn();
    render(<RatingInput value={0} onSelect={onSelect} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sett 2.5' }));
    expect(onSelect).toHaveBeenCalledWith(2.5);
  });

  it('shows the hovered rating in the fixed text slot and the set rating again on leave', () => {
    render(<RatingInput value={2} onSelect={vi.fn()} showValue {...props} />);
    const group = screen.getByRole('group', { name: 'Betyg' });
    sizeTrack(group);
    expect(screen.getByText('2 av 5')).toBeTruthy();
    fireEvent.pointerMove(group, { pointerType: 'mouse', clientX: 70 });
    expect(screen.getByText('3,5 av 5')).toBeTruthy();
    fireEvent.pointerLeave(group, { pointerType: 'mouse' });
    expect(screen.getByText('2 av 5')).toBeTruthy();
  });

  it('says there is no rating when none is set', () => {
    render(<RatingInput value={0} onSelect={vi.fn()} showValue {...props} />);
    expect(screen.getByText('Inget betyg')).toBeTruthy();
  });

  it('a finger previews while down and sets the rating once, on lift', () => {
    const onSelect = vi.fn();
    render(<RatingInput value={0} onSelect={onSelect} showValue {...props} />);
    const group = screen.getByRole('group', { name: 'Betyg' });
    sizeTrack(group);
    fireEvent.pointerDown(group, { pointerType: 'touch', pointerId: 1, clientX: 30 });
    expect(screen.getByText('1,5 av 5')).toBeTruthy();
    fireEvent.pointerMove(group, { pointerType: 'touch', pointerId: 1, clientX: 90 });
    expect(screen.getByText('4,5 av 5')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerUp(group, { pointerType: 'touch', pointerId: 1, clientX: 90 });
    // The click the browser sends after the lift must not set it a second time.
    fireEvent.click(screen.getByRole('button', { name: 'Sett 4.5' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(4.5);
  });

  it('a swipe the browser takes over for scrolling sets nothing', () => {
    const onSelect = vi.fn();
    render(<RatingInput value={0} onSelect={onSelect} showValue {...props} />);
    const group = screen.getByRole('group', { name: 'Betyg' });
    sizeTrack(group);
    fireEvent.pointerDown(group, { pointerType: 'touch', pointerId: 1, clientX: 30 });
    fireEvent.pointerCancel(group, { pointerType: 'touch', pointerId: 1 });
    fireEvent.pointerUp(group, { pointerType: 'touch', pointerId: 1, clientX: 90 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Inget betyg')).toBeTruthy();
  });

  it('disabled holds every button and ignores touch', () => {
    const onSelect = vi.fn();
    render(<RatingInput value={0} onSelect={onSelect} disabled {...props} />);
    const group = screen.getByRole('group', { name: 'Betyg' });
    sizeTrack(group);
    fireEvent.pointerDown(group, { pointerType: 'touch', pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(group, { pointerType: 'touch', pointerId: 1, clientX: 50 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sett 5' })).toBeDisabled();
  });
});
