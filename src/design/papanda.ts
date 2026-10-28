import tokens from '../../design-system/papanda-design-system-0.7.167/tokens.json';

/** Family roles from the pinned kit. Apply screen by screen after owner review. */
export const papanda = {
  color: { ...tokens.inherited.color, ...tokens.components.color },
  radius: tokens.inherited.radiusPx,
  control: tokens.components.control,
  compactControl: tokens.components.compactControl,
  focus: tokens.components.focus,
  // Local extension: a learning card remains comfortably readable on wide screens.
  learningColumnWidth: 560,
} as const;
