import React, { memo, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { BookBlock, BookCell } from '../models/book';
import { ACCENT_DARK } from '../constants/theme';

export function BookMarkdown({ children, fontSize = 17 }: { children: string; fontSize?: number }) {
  const style = useMemo(() => ({ body: { fontSize, lineHeight: Math.round(fontSize * 1.55), color: '#334155' },
    paragraph: { marginTop: 0, marginBottom: 8 }, strong: { color: '#172033', fontWeight: '700' as const },
    heading1: { fontSize: fontSize + 5 }, heading2: { fontSize: fontSize + 3 },
    link: { color: ACCENT_DARK }, bullet_list: { marginBottom: 8 }, ordered_list: { marginBottom: 8 },
    code_inline: { backgroundColor: '#EEF2F6', color: '#334155' },
  }), [fontSize]);
  return <Markdown style={style}>{children}</Markdown>;
}

// Expand rowspans so the card view repeats the shared context on every affected row.
function tableGrid(rows: BookCell[][]) {
  const grid: (BookCell | null)[][] = [];
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let col = 0;
    row.forEach(cell => {
      while (grid[r][col]) col++;
      for (let down = 0; down < cell.rowSpan; down++) {
        grid[r + down] ??= [];
        for (let across = 0; across < cell.colSpan; across++) grid[r + down][col + across] = cell;
      }
      col += cell.colSpan;
    });
  });
  return grid.slice(0, rows.length);
}
const TableContent = memo(function TableContent({ block, fontSize }: { block: Extract<BookBlock, { kind: 'table' }>; fontSize: number }) {
  const [asTable, setAsTable] = useState(false);
  const grid = useMemo(() => tableGrid(block.rows), [block.rows]);
  const columns = Math.max(...grid.map(row => row.length));
  const headers = grid.filter((_, i) => block.rows[i].every(cell => cell.header));
  const label = (col: number) => [...new Set(headers.map(row => row[col]?.text).filter(Boolean))].join(' · ');
  if (grid.length === 2 && block.text.includes('подлежащее') && block.text.includes('сказуемое') && block.text.includes('обстоятельство')) {
    return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 }}>
      {grid[0].map((cell, col) => <View key={col} style={{ padding: 10, borderRadius: 10, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7DEE8' }}>
        <Text style={{ fontSize, color: '#172033', fontWeight: '600' }}>{cell?.text}</Text>
        <Text style={{ fontSize: 12, color: '#64748B', marginTop: 5 }}>{grid[1][col]?.text}</Text>
      </View>)}
    </View>;
  }
  return <View style={s.tableWrap}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={asTable ? 'Показать таблицу карточками' : 'Показать исходную таблицу'} onPress={() => setAsTable(value => !value)} style={s.switch}>
      <Text style={s.link}>{asTable ? 'В виде карточек' : 'В виде таблицы ↔'}</Text>
    </TouchableOpacity>
    {asTable ? <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 10 }}>
      <View accessibilityLabel="Таблица с горизонтальной прокруткой">
        {grid.map((row, r) => <View key={r} style={{ flexDirection: 'row' }}>{Array.from({ length: columns }, (_, col) => {
          const cell = row[col];
          return <View key={col} style={[s.gridCell, { width: 156, backgroundColor: cell?.header ? '#EEF2F6' : '#FFF' }]}>
            {!!cell && <BookMarkdown fontSize={fontSize - 1}>{cell.markdown}</BookMarkdown>}
          </View>;
        })}</View>)}
      </View>
    </ScrollView> : <>
      {!!headers.length && <Text style={s.hint}>Столбцы таблицы показаны последовательно в карточках.</Text>}
      {grid.map((row, r) => {
        if (block.rows[r].every(cell => cell.header)) return null;
        const unique = row.filter((cell, col) => cell && (col === 0 || cell !== row[col - 1]));
        if (unique.length === 1 && unique[0]!.colSpan >= columns) return <View key={r} style={s.tableSection}><BookMarkdown fontSize={fontSize}>{unique[0]!.markdown}</BookMarkdown></View>;
        return <View key={r} style={s.tableCard}>{row.map((cell, col) => {
          if (!cell || (col > 0 && cell === row[col - 1])) return null;
          const labels = Array.from({ length: cell.colSpan }, (_, i) => label(col + i)).filter(Boolean);
          return <View key={col} style={s.field}>
            {!!labels.length && <Text style={s.fieldTitle}>{[...new Set(labels)].join(' / ')}</Text>}
            <BookMarkdown fontSize={fontSize}>{cell.markdown}</BookMarkdown>
          </View>;
        })}</View>;
      })}
    </>}
  </View>;
});

export const BookBlockContent = memo(function BookBlockContent({ block, fontSize }: { block: BookBlock; fontSize: number }) {
  if (block.kind === 'heading') return <Text accessibilityRole="header" style={[s.heading, { fontSize: fontSize + (block.level === 1 ? 7 : 3) }]}>{block.text}</Text>;
  if (block.kind === 'table') return <TableContent block={block} fontSize={fontSize} />;
  return <BookMarkdown fontSize={fontSize}>{block.markdown}</BookMarkdown>;
});
const s = StyleSheet.create({
  heading: { color: '#172033', fontWeight: '700', marginTop: 16, marginBottom: 10, lineHeight: 32 },
  tableWrap: { marginVertical: 8, gap: 8 }, switch: { paddingVertical: 10, alignSelf: 'flex-start' },
  link: { color: ACCENT_DARK, fontSize: 14, fontWeight: '600' }, hint: { fontSize: 13, color: '#64748B', lineHeight: 19 },
  tableSection: { borderLeftWidth: 3, borderLeftColor: '#E7AF45', backgroundColor: '#FFF7E8', padding: 12, borderRadius: 8 },
  tableCard: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, backgroundColor: '#FFF', marginBottom: 8 },
  field: { paddingVertical: 5 }, fieldTitle: { fontSize: 13, color: '#64748B', fontWeight: '600', marginBottom: 4 },
  gridCell: { padding: 10, borderWidth: 0.5, borderColor: '#CBD5E1' },
});
