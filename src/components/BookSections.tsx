import React, { useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BookChapter } from '../models/book';
import { ACCENT_BORDER, ACCENT_DARK, ACCENT_LIGHT } from '../constants/theme';

interface Props {
  chapter: BookChapter;
  currentBlockId?: string;
  fontSize: number;
  onSelect: (blockId: string) => void;
  onClose: () => void;
}

export function BookSections({ chapter, currentBlockId, fontSize, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const sections = chapter.blocks.filter(block => block.kind === 'heading');
  const firstLevel = Math.min(...sections.map(section => section.level));
  let activeId = sections[0]?.id;
  for (const block of currentBlockId ? chapter.blocks : []) {
    if (block.kind === 'heading') activeId = block.id;
    if (block.id === currentBlockId) break;
  }

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={[s.overlay, { paddingTop: Math.max(insets.top, 16) }]}>
      <Pressable testID="book-sections-backdrop" accessible={false} focusable={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View testID="book-sections-panel" accessibilityViewIsModal onAccessibilityEscape={onClose}
        style={[s.sheet, { maxHeight: height - Math.max(insets.top, 16) - 16 }]}>
        <View style={s.header}>
          <View style={s.heading}>
            <Text accessibilityRole="header" style={s.title}>Разделы главы</Text>
            <Text style={s.subtitle} numberOfLines={2}>{chapter.title}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Закрыть разделы главы" onPress={onClose} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView ref={scroll} testID="book-sections-list" style={s.scroll}
          contentContainerStyle={[s.sections, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {sections.map((section, index) => {
            const active = section.id === activeId;
            return <TouchableOpacity key={section.id} testID={`book-section-${section.id}`} accessibilityRole="button"
              accessibilityState={{ selected: active }} aria-selected={active} accessibilityLabel={`${section.text}${active ? ', текущий раздел' : ''}`}
              onPress={() => onSelect(section.id)}
              onLayout={event => {
                if (active) scroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 8), animated: false });
              }}
              style={[s.section, { marginLeft: Math.min(section.level - firstLevel, 2) * 12 }, active && s.activeSection]}>
              <Text style={[s.number, active && s.activeText]}>{String(index + 1).padStart(2, '0')}</Text>
              <View style={s.sectionBody}>
                <Text style={[s.sectionTitle, { fontSize, lineHeight: Math.round(fontSize * 1.4) }, active && s.activeText]}>{section.text}</Text>
                {active && <Text style={s.current}>Вы здесь</Text>}
              </View>
              <Text style={[s.arrow, active && s.activeText]}>{active ? '•' : '›'}</Text>
            </TouchableOpacity>;
          })}
          {!sections.length && <Text style={s.subtitle}>Эта глава читается последовательно.</Text>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', flexShrink: 1, backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 20, paddingRight: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  heading: { flex: 1, gap: 4 }, title: { fontSize: 20, lineHeight: 28, fontWeight: '700', color: '#172033' },
  subtitle: { fontSize: 13, lineHeight: 19, color: '#64748B' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#F1F5F9' },
  closeText: { fontSize: 20, color: '#475569' }, scroll: { flexGrow: 0, flexShrink: 1 }, sections: { padding: 12, gap: 6 },
  section: { flexDirection: 'row', alignItems: 'center', minHeight: 64, padding: 14, gap: 12, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  activeSection: { backgroundColor: ACCENT_LIGHT, borderColor: ACCENT_BORDER }, number: { minWidth: 24, fontSize: 12, color: '#94A3B8', fontWeight: '700' },
  sectionBody: { flex: 1, gap: 4 }, sectionTitle: { color: '#334155', fontWeight: '600' },
  activeText: { color: ACCENT_DARK }, current: { fontSize: 12, lineHeight: 18, color: ACCENT_DARK }, arrow: { fontSize: 22, color: '#94A3B8' },
});
