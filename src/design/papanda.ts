import tokens from '../../design-system/papanda-design-system-0.7.167/tokens.json';
import { ACCENT, ACCENT_DARK, ACCENT_LIGHT, ACCENT_PRESSED, UI } from '../constants/theme';

/** Owner-requested local reading adaptation; the pinned kit is a reference. */
export const papanda = {
  color: {
    ...tokens.inherited.color, ...tokens.components.color,
    canvas: UI.canvas, surface: UI.surface, surfaceSubtle: UI.subtle,
    text: UI.text, textBody: UI.body, textSecondary: UI.muted,
    border: UI.border, borderSubtle: UI.border,
    accent: ACCENT, accentHover: ACCENT_PRESSED, accentSoft: ACCENT_LIGHT,
    accentText: ACCENT_DARK, onAccent: UI.onAccent,
  },
  radius: { small: 8, control: 10, medium: 12, surface: UI.radius },
  control: tokens.components.control,
  compactControl: tokens.components.compactControl,
  focus: tokens.components.focus,
  // Local extension: a learning card remains comfortably readable on wide screens.
  learningColumnWidth: 560,
} as const;
