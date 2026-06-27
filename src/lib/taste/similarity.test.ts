import { describe, it, expect } from 'vitest';
import { cosineSimilarity, matchPercent, scoreCandidateForUser } from './similarity';
import type { TasteVector } from '@/types';

const v = (genres: Record<number, number>): TasteVector => ({ genres, sampleSize: 1 });

describe('cosineSimilarity', () => {
  it('identical vectors → 1', () => {
    expect(cosineSimilarity(v({ 18: 1, 35: 1 }), v({ 18: 1, 35: 1 }))).toBeCloseTo(1, 10);
  });
  it('proportional vectors → 1 (direction, not magnitude)', () => {
    expect(cosineSimilarity(v({ 18: 1, 35: 1 }), v({ 18: 2, 35: 2 }))).toBeCloseTo(1, 10);
  });
  it('orthogonal vectors (no shared genre) → 0', () => {
    expect(cosineSimilarity(v({ 18: 1 }), v({ 35: 1 }))).toBe(0);
  });
  it('a zero-magnitude vector → 0 (no divide-by-zero)', () => {
    expect(cosineSimilarity(v({}), v({ 18: 1 }))).toBe(0);
  });
  it('opposite vectors → -1', () => {
    expect(cosineSimilarity(v({ 18: 1 }), v({ 18: -1 }))).toBeCloseTo(-1, 10);
  });
});

describe('matchPercent', () => {
  it('identical → 100', () => {
    expect(matchPercent(v({ 18: 1 }), v({ 18: 1 }))).toBe(100);
  });
  it('orthogonal → 0', () => {
    expect(matchPercent(v({ 18: 1 }), v({ 35: 1 }))).toBe(0);
  });
  it('clamps a negative cosine to 0 rather than a negative percent', () => {
    expect(matchPercent(v({ 18: 1 }), v({ 18: -1 }))).toBe(0);
  });
});

describe('scoreCandidateForUser', () => {
  it('empty candidate genres → 0', () => {
    expect(scoreCandidateForUser([], v({ 18: 1 }))).toBe(0);
  });
  it('sums the user weight for the candidate genres, normalised per genre', () => {
    // genres [18,35]; user weights 1.0 + 0.0 → 1.0/2 = 0.5
    expect(scoreCandidateForUser([18, 35], v({ 18: 1.0 }))).toBeCloseTo(0.5, 10);
  });
  it('missing genre keys contribute 0', () => {
    expect(scoreCandidateForUser([99], v({ 18: 1 }))).toBe(0);
  });
  it('carries through negative weights (an avbruten-penalised genre lowers the score)', () => {
    expect(scoreCandidateForUser([18], v({ 18: -0.5 }))).toBeCloseTo(-0.5, 10);
  });
});
