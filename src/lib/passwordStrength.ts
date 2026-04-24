/**
 * Enkel lösenordsstyrke-heuristik. Medvetet inte zxcvbn-nivå — den drar in
 * ~1 MB gzip i bundle:n och är overkill. Vi blockerar registrering vid
 * score < 2 (offline-crack i timmar eller bättre).
 */

// Lista av TOP-50 svenska + generiska lösenord. Hårdkodad här istället för
// extern lista för att undvika bundle-bloat — den fångar de flesta
// första-försöks-gissningarna.
const COMMON_PASSWORDS = new Set([
  'password', 'passwd', 'qwerty', 'qwerty123', 'abc123', '123456',
  '12345678', '123456789', '1234567890', 'admin', 'administrator',
  'letmein', 'welcome', 'monkey', 'dragon', 'master', 'sunshine',
  'iloveyou', 'princess', 'trustno1', 'hejsan', 'hejhej', 'hejhopp',
  'sverige', 'stockholm', 'sommar', 'vinter', 'fotboll', 'kärlek',
  'kalle', 'anna', 'linda', 'mamma', 'pappa', 'pojkvän', 'flickvän',
  'password1', 'password123', 'qwerty1', '123qwe', 'asdfgh',
  'zxcvbn', 'qwertyuiop', 'hello123', 'binge', 'bingenu',
]);

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  feedback: string;
  acceptable: boolean;
}

export function scorePassword(password: string): PasswordStrength {
  if (password.length === 0) {
    return { score: 0, label: '', feedback: '', acceptable: false };
  }

  if (password.length < 8) {
    return {
      score: 0,
      label: 'För kort',
      feedback: 'Minst 8 tecken krävs.',
      acceptable: false,
    };
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return {
      score: 0,
      label: 'För vanligt',
      feedback: 'Det här lösenordet finns i kända läckor. Välj något annat.',
      acceptable: false,
    };
  }

  // Klass-diversitet: hur många av (lowercase, uppercase, digits, symbols)?
  const hasLower = /[a-zåäö]/.test(password);
  const hasUpper = /[A-ZÅÄÖ]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^a-zA-ZÅÄÖåäö\d]/.test(password);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  // Längd-tier kombinerat med klass-diversitet.
  let score: 0 | 1 | 2 | 3 | 4;
  if (password.length >= 16 && classes >= 3) score = 4;
  else if (password.length >= 12 && classes >= 2) score = 3;
  else if (password.length >= 10 || classes >= 3) score = 2;
  else score = 1;

  const labels = ['', 'Svagt', 'Okej', 'Bra', 'Starkt'];
  const feedbacks = [
    '',
    'Försök längre eller lägg till siffror/symboler.',
    'Längre är bättre — sikta på 12+ tecken.',
    'Bra styrka.',
    'Stark.',
  ];

  return {
    score,
    label: labels[score],
    feedback: feedbacks[score],
    acceptable: score >= 2,
  };
}
