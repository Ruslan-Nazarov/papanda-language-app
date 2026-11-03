import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Tabs stay mounted: refresh date-dependent views on return and at local midnight. */
export function useScreenClock(refreshMs = Infinity): number {
  const focused = useIsFocused();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!focused) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current.getTime());
      const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = setTimeout(refresh, Math.max(1000, Math.min(refreshMs, midnight.getTime() - current.getTime())));
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
      else clearTimeout(timer);
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [focused, refreshMs]);
  return now;
}
