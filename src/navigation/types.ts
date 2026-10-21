import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainTabParamList = {
  Statistics: undefined;
  'Word Triples': undefined;
  'Sentence Trainer': undefined;
  'Brain Workout': undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Dictionary: undefined;
  Book: { language?: string; chapterId?: string; blockId?: string } | undefined;
  SentenceWorkshop: { sentenceId?: string; language?: string; mode?: 'Самостоятельно' | 'Нарастающее' | 'Развитие' | 'Языки' | 'Мой текст' } | undefined;
};

export type WordTriplesScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Word Triples'>,
  NativeStackScreenProps<RootStackParamList>
>;
export type DictionaryScreenProps = NativeStackScreenProps<RootStackParamList, 'Dictionary'>;
