import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { UI } from '../constants/theme';

const sources = {
  chart: 'bar-chart-outline', check: 'checkmark-outline', edit: 'create-outline',
  eye: 'eye-outline', idea: 'bulb-outline', language: 'chatbubble-ellipses-outline',
  microphone: 'volume-medium-outline', next: 'arrow-forward-outline',
  read: 'book-outline', star: 'star-outline', warning: 'alert-circle-outline',
  workout: 'layers-outline', settings: 'settings-outline',
} as const;

/** One outline set; original Doodle assets and licences remain in the kit. */
export default function PapandaIcon({ name, size = 20, color = UI.muted }: {
  name: keyof typeof sources; size?: number; color?: string;
}) {
  return <Ionicons name={sources[name]} size={size} color={color} accessible={false}
    style={{ width: size, height: size, lineHeight: size }} />;
}
