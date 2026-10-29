// Single source of truth for the app's brand accent. Keep semantic colors used
// for sentence-role legends (Subject/Predicate/Object/etc. in SentenceTrainerScreen
// and Onboarding) as they are — those encode grammar, not brand, and swapping them
// would break their meaning.
export const ACCENT = '#F2994A';
export const ACCENT_DARK = '#C2410C';
export const ACCENT_PRESSED = '#D87D2D';
export const ACCENT_LIGHT = '#FFF1E5';
export const ACCENT_BORDER = '#FED7AA';
export const ACCENT_TEXT_ON_LIGHT = '#C2410C';

// Local mobile reading theme. The reference kit remains unchanged.
export const UI = {
  canvas: '#F5F6F8', surface: '#FFFFFF', subtle: '#F0F2F5',
  text: '#202936', body: '#3F4B5A', muted: '#5F6C7B', border: '#DCE1E7',
  onAccent: '#202936', radius: 12, column: 600,
  heading: { fontSize: 22, lineHeight: 30, fontWeight: '600' as const },
  reading: { fontSize: 16, lineHeight: 25 },
  caption: { fontSize: 13, lineHeight: 19 },
} as const;
