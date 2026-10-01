import { getDefaultNormalizer } from '@testing-library/react';

// BIN-1386: a kronbelopp assertion must not depend on which space character the
// runtime's sv-SE ICU data uses as the thousands separator. Write the expected text
// with plain spaces; each space then matches U+0020, U+00A0 or U+202F and nothing else.
const ANY_SPACE = '[ \\u00A0\\u202F]';

export function krText(expected: string): RegExp {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/ /g, ANY_SPACE)}$`);
}

// The default normalizer folds every \s run, NBSP included, into a plain space, so
// the matcher would never see the separator itself. Pass this to getByText instead.
export const verbatim = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };
