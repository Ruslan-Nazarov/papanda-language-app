import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';

// Text uses the platform UI font, including Cyrillic and Kazakh. Load bundled
// icons before showing the app so controls never change geometry.
export function usePapandaFonts() {
  const [loaded, error] = useFonts(Ionicons.font);
  return loaded || !!error;
}
