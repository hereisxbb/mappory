import { DynamicColorIOS, Platform } from 'react-native';
import type { MemoryCategory } from './types';

function adaptive(light: string, dark: string): any {
  return Platform.OS === 'ios'
    ? DynamicColorIOS({ light, dark })
    : light;
}

export const palette = {
  // Text / surfaces automatically follow the active iOS appearance.
  ink: adaptive('#202722', '#F2F3EF'),
  muted: adaptive('#70766F', '#B4BDB5'),
  disabled: adaptive('#A2A39F', '#6E776F'),
  paper: adaptive('#FBF8F1', '#101310'),
  card: adaptive('#FFFDF8', '#1A1F1B'),
  line: adaptive('#E9E4DA', '#303732'),

  // Accent greens.
  moss: adaptive('#607565', '#8EAF98'),
  mossDark: adaptive('#415548', '#B7D0BC'),
  mossPale: adaptive('#E6ECE6', '#253129'),

  // Surfaces used by secondary controls.
  soft: adaptive('#F2EFE9', '#242925'),
  softGreen: adaptive('#F1F4EF', '#202A23'),
  softDanger: adaptive('#F6EAE6', '#382421'),

  // Primary action remains a dark green in both schemes, so white button
  // labels stay legible in dark mode too.
  action: adaptive('#202722', '#314238'),

  terracotta: adaptive('#B9675B', '#F0A08D'),
  blue: '#6A7F91',
  gold: '#A78A56',
  white: '#FFFFFF',
  black: '#111511',
};

// Soft, lower-saturation category colors remain intentionally stable across
// light/dark mode so users keep their visual category identity.
export const categoryColors = [
  '#B7CBB9',
  '#E7AE9A',
  '#DCC78F',
  '#AFC8DC',
  '#C7BAD5',
  '#E2B7C2',
  '#A9CCC7',
  '#D8C0AA',
  '#C3CF9F',
  '#CDB5C0',
  '#A7CAD5',
  '#EDC4A7',
  '#BFC3D8',
  '#D8C9B8',
];

export const categorySymbols = ['⌖', '●', '◒', '△', '○', '◆', '✦', '◇'];

export const defaultCategories: MemoryCategory[] = [
  { id: 'travel', name: '旅行地点', color: '#B7CBB9', symbol: '⌖', createdAt: 1 },
  { id: 'food', name: '好吃的', color: '#E7AE9A', symbol: '●', createdAt: 2 },
  { id: 'cafe', name: '咖啡', color: '#DCC78F', symbol: '◒', createdAt: 3 },
  { id: 'scenery', name: '风景', color: '#AFC8DC', symbol: '△', createdAt: 4 },
  { id: 'daily', name: '日常', color: '#C7BAD5', symbol: '○', createdAt: 5 },
  {
    id: 'uncategorized',
    name: '未分类',
    color: '#D8C9B8',
    symbol: '◇',
    protected: true,
    createdAt: 6,
  },
];

export const personalTags = [
  '会专门再去',
  '一个人很舒服',
  '天气很好那天',
  '意外发现',
  '因为动画来的',
  '妈妈应该会喜欢',
  '适合晚上',
  '值得慢慢走',
];
