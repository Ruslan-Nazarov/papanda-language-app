import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { progressStorage, useStorageStatus } from '../services/progressStorage';

export default function StorageNotice() {
  const failed = useStorageStatus(state => state.failedKeys.length > 0);
  const [retrying, setRetrying] = useState(false);
  const insets = useSafeAreaInsets();
  if (!failed) return null;
  const retry = async () => {
    setRetrying(true);
    try { await progressStorage.retry(); } catch { /* The notice stays until all writes succeed. */ }
    finally { setRetrying(false); }
  };
  return <View accessibilityRole="alert" style={[styles.notice, { paddingTop: Math.max(12, insets.top) }]}>
    <Text style={styles.text}>Изменения ещё не сохранены на устройстве. Освободите место и повторите сохранение. До этого не закрывайте приложение; резервную копию можно сделать в настройках.</Text>
    <TouchableOpacity accessibilityRole="button" disabled={retrying} onPress={() => void retry()} style={styles.button}>
      <Text style={styles.label}>{retrying ? 'Сохраняем…' : 'Повторить сохранение'}</Text>
    </TouchableOpacity>
  </View>;
}
const styles = StyleSheet.create({
  notice: { padding: 12, backgroundColor: '#FFF4E5', borderBottomWidth: 1, borderBottomColor: '#D97706' },
  text: { color: '#78350F', fontSize: 13, lineHeight: 18 },
  button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { color: '#78350F', fontWeight: '700' },
});
