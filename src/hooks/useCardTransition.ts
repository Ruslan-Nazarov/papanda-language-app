import { useLayoutEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

export type SwipeDirection = 'left' | 'right';

/** An animated answer belongs to the visible card and its current session.
 * Invalidate callbacks before stopping the native animation: stopAnimation can
 * itself invoke the completion callback. Direct buttons share the same lock.
 */
export function useCardTransition(options: {
  enabled: boolean;
  scope: string;
  cardKey: string;
  onSwipe: (direction: SwipeDirection) => void;
  canSwipe?: (direction: SwipeDirection) => boolean;
  distance: number;
  entryOffset: number;
  duration: number;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const phase = useRef<'idle' | 'exiting' | 'entering'>('idle');
  const committing = useRef(false);
  const revision = useRef(0);
  const frame = useRef<number | undefined>(undefined);
  const current = useRef(options);
  current.current = options;

  const cancel = () => {
    revision.current++;
    busy.current = false;
    phase.current = 'idle';
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    translateX.stopAnimation();
    translateX.setValue(0);
  };
  useLayoutEffect(() => {
    cancel();
    return cancel;
  }, [options.enabled, options.scope]);

  const reset = () => {
    if (busy.current || !current.current.enabled) return;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 5 }).start();
  };
  const animate = (direction: SwipeDirection) => {
    const start = current.current;
    // The next card is already interactive during its entrance animation.
    if (phase.current === 'entering') cancel();
    if (busy.current || !start.enabled) return;
    if (start.canSwipe && !start.canSwipe(direction)) { reset(); return; }
    const id = ++revision.current;
    busy.current = true;
    phase.current = 'exiting';
    const sign = direction === 'left' ? -1 : 1;
    Animated.timing(translateX, { toValue: sign * start.distance, duration: start.duration,
      easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (id !== revision.current) return;
      const latest = current.current;
      if (!finished || !latest.enabled || latest.scope !== start.scope || latest.cardKey !== start.cardKey) {
        cancel(); return;
      }
      translateX.setValue(-sign * start.entryOffset);
      phase.current = 'entering';
      committing.current = true;
      try { latest.onSwipe(direction); } finally { committing.current = false; }
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (id !== revision.current || !current.current.enabled) return;
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 4 })
          .start(() => { if (id === revision.current) { busy.current = false; phase.current = 'idle'; } });
      });
    });
  };
  const beginAction = () => {
    if (!current.current.enabled) return false;
    if (committing.current) return true;
    if (phase.current === 'entering') cancel();
    return !busy.current;
  };
  return { translateX, busy, animate, reset, beginAction };
}
