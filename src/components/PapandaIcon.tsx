import React from 'react';
import { Image } from 'react-native';
import { papanda } from '../design/papanda';

const sources = {
  chart: require('../../assets/papanda-doodle/chart.png'),
  check: require('../../assets/papanda-doodle/check.png'),
  edit: require('../../assets/papanda-doodle/edit.png'),
  eye: require('../../assets/papanda-doodle/eye.png'),
  idea: require('../../assets/papanda-doodle/idea.png'),
  language: require('../../assets/papanda-doodle/language.png'),
  microphone: require('../../assets/papanda-doodle/microphone.png'),
  next: require('../../assets/papanda-doodle/next.png'),
  read: require('../../assets/papanda-doodle/read.png'),
  star: require('../../assets/papanda-doodle/star.png'),
  warning: require('../../assets/papanda-doodle/warning.png'),
} as const;

/** PNG derivatives retain the supplied Doodle geometry on native and web. */
export default function PapandaIcon({ name, size = 20, color = papanda.color.accentHover }: {
  name: keyof typeof sources; size?: number; color?: string;
}) {
  return <Image source={sources[name]} accessible={false} style={{ width: size, height: size, tintColor: color }} resizeMode="contain" />;
}
