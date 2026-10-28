import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { papanda } from '../design/papanda';

/** Pilot action: visible keyboard focus, with no layout shift or extra motion. */
export default function PapandaAction(props: React.ComponentProps<typeof TouchableOpacity>) {
  const [focused, setFocused] = useState(false);
  return <TouchableOpacity {...props}
    accessibilityRole={props.accessibilityRole ?? 'button'}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }}
    onBlur={event => { setFocused(false); props.onBlur?.(event); }}
    style={[props.style, focused && {
      outlineColor: papanda.focus.color, outlineStyle: 'solid',
      outlineWidth: papanda.focus.widthPx, outlineOffset: papanda.focus.offsetPx,
    }]} />;
}
