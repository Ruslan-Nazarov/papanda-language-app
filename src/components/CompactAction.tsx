import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { papanda } from '../design/papanda';
import PapandaAction from './PapandaAction';

type Props = React.ComponentProps<typeof PapandaAction> & {
  surfaceStyle?: StyleProp<ViewStyle>;
};

/** Compact paint inside a full touch target; no overlapping hitSlop required. */
export default function CompactAction({ children, style, surfaceStyle, ...props }: Props) {
  return <PapandaAction {...props} style={[styles.target, style]}>
    <View style={[styles.surface, surfaceStyle]}>{children}</View>
  </PapandaAction>;
}

const styles = StyleSheet.create({
  target: { minHeight: papanda.control.minHeightPx, alignSelf: 'flex-start', justifyContent: 'center' },
  surface: { minHeight: papanda.compactControl.visualHeightPx, justifyContent: 'center' },
});
