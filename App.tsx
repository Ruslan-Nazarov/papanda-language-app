import type { MainTabParamList, RootStackParamList } from './src/navigation/types';
import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ACCENT_DARK, ACCENT_LIGHT, UI } from './src/constants/theme';
import PapandaIcon from './src/components/PapandaIcon';
import { usePapandaFonts } from './src/design/usePapandaFonts';

import WordTriplesScreen from './src/screens/WordTriplesScreen';
import SentenceTrainerScreen from './src/screens/SentenceTrainerScreen';
import SentenceWorkshopScreen from './src/screens/SentenceWorkshopScreen';
import NotesScreen from './src/screens/NotesScreen';
import NoteEditorScreen from './src/screens/NoteEditorScreen';
import BookScreen from './src/screens/BookScreen';
import DictionaryScreen from './src/screens/DictionaryScreen';
import BrainWorkoutScreen from './src/screens/BrainWorkoutScreen';
import StatisticsScreen from './src/screens/StatisticsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ExperimentsScreen from './src/screens/ExperimentsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { useStore, useHydrationState } from './src/store/useStore';
import { useBookStore, useBookHydrationState } from './src/store/bookStore';
import StorageNotice from './src/components/StorageNotice';

const ONBOARDING_KEY = 'papanda-onboarded';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TABS = {
  Statistics: { icon: 'chart', label: 'Прогресс' },
  'Word Triples': { icon: 'read', label: 'Слова' },
  'Sentence Trainer': { icon: 'language', label: 'Разбор' },
  'Brain Workout': { icon: 'workout', label: 'Повтор' },
  Settings: { icon: 'settings', label: 'Настройки' },
} as const;

// The sentence trainer stays in the centre and remains the first screen.
const CENTER_TAB = 'Sentence Trainer';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={boundaryStyles.container}>
        <Text style={boundaryStyles.emoji}>⚠️</Text>
        <Text style={boundaryStyles.title}>Что-то пошло не так</Text>
        <Text style={boundaryStyles.sub}>
          Экран не смог отобразиться из-за внутренней ошибки. Мы уже изолировали её, чтобы приложение не упало целиком.
        </Text>
        <TouchableOpacity style={boundaryStyles.button} onPress={() => this.setState({ error: null })}>
          <Text style={boundaryStyles.buttonText}>Попробовать снова</Text>
        </TouchableOpacity>
        {__DEV__ && (
          <ScrollView style={boundaryStyles.details}>
            <Text style={boundaryStyles.detailsText}>
              {this.state.error.name}: {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const progressRevision = useStore(state => state.progressRevision);
  const bottomInset = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 12 : 8);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      // One iMW data point per day the app is opened.
      useStore.getState().recordImwSnapshot();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Tab.Navigator
      initialRouteName={CENTER_TAB}
      screenOptions={({ route }) => {
        const tab = TABS[route.name];
        return {
          tabBarShowLabel: true,
          tabBarLabel: tab.label,
          tabBarLabelPosition: 'below-icon',
          tabBarLabelStyle: tabStyles.label,
          tabBarAccessibilityLabel: route.name,
          tabBarIcon: ({ focused }) => <View style={[tabStyles.icon, focused && tabStyles.activeIcon]}>
            <PapandaIcon name={tab.icon} size={22} color={focused ? ACCENT_DARK : UI.muted} />
          </View>,
          tabBarActiveTintColor: ACCENT_DARK,
          tabBarInactiveTintColor: UI.muted,
          tabBarIconStyle: tabStyles.iconSlot,
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: UI.border,
            borderTopWidth: 1,
            paddingTop: 6,
            paddingBottom: bottomInset,
            minHeight: 64 + bottomInset,
            height: 'auto',
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarItemStyle: {
            minWidth: 0,
            justifyContent: 'center',
            alignItems: 'stretch',
          },
        };
      }}
    >
      <Tab.Screen name="Statistics" component={StatisticsScreen} />
      <Tab.Screen name="Word Triples">
        {props => <WordTriplesScreen key={progressRevision} {...props} />}
      </Tab.Screen>
      <Tab.Screen name="Sentence Trainer">
        {() => <SentenceTrainerScreen key={progressRevision} />}
      </Tab.Screen>
      <Tab.Screen name="Brain Workout">
        {() => <BrainWorkoutScreen key={progressRevision} />}
      </Tab.Screen>
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const fontsReady = usePapandaFonts();
  const hydration = useHydrationState();
  const bookHydration = useBookHydrationState();
  const progressRevision = useStore(state => state.progressRevision);
  // Store hydration (and the derived `words`/`sentences` rebuild) is handled by
  // the persist `onRehydrateStorage` hook in the store itself.
  // `null` = still reading the flag, `false` = show onboarding, `true` = go to the app.
  const [onboarded, setOnboarded] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((value) => setOnboarded(value === '1'))
      .catch(() => setOnboarded(true)); // on a storage error, don't trap the user on onboarding
  }, []);

  const finishOnboarding = React.useCallback(() => {
    setOnboarded(true);
    AsyncStorage.setItem(ONBOARDING_KEY, '1').catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ErrorBoundary>
        <StorageNotice />
        {hydration.error || bookHydration.error ? (
          <View style={boundaryStyles.container}>
            <Text style={boundaryStyles.sub}>{hydration.error || bookHydration.error}</Text>
            <TouchableOpacity style={boundaryStyles.button} onPress={() => {
              if (!hydration.ready) void useStore.persist.rehydrate();
              if (!bookHydration.ready) void useBookStore.persist.rehydrate();
            }}>
              <Text style={boundaryStyles.buttonText}>Повторить загрузку</Text>
            </TouchableOpacity>
          </View>
        ) : !fontsReady || onboarded === null || !hydration.ready || !bookHydration.ready ? (
          <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
        ) : onboarded === false ? (
          <OnboardingScreen onDone={finishOnboarding} />
        ) : (
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="MainTabs" component={MainTabs} />
              <Stack.Screen name="Book" component={BookScreen} />
              <Stack.Screen name="Experiments" component={ExperimentsScreen} />
              <Stack.Screen name="Dictionary">
                {props => <DictionaryScreen key={progressRevision} {...props} />}
              </Stack.Screen>
              <Stack.Screen name="Notes">
                {props => <NotesScreen key={progressRevision} {...props} />}
              </Stack.Screen>
              <Stack.Screen name="NoteEditor">
                {props => <NoteEditorScreen key={progressRevision} {...props} />}
              </Stack.Screen>
              <Stack.Screen name="SentenceWorkshop">
                {props => <SentenceWorkshopScreen key={progressRevision} {...props} />}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const tabStyles = StyleSheet.create({
  iconSlot: { width: 44, height: 30 },
  icon: { width: 44, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  activeIcon: { backgroundColor: ACCENT_LIGHT },
  label: { fontSize: 10, lineHeight: 16, fontWeight: '500', marginTop: 2 },
});

const boundaryStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1A202C', marginBottom: 8 },
  sub: { ...UI.reading, color: UI.muted, textAlign: 'center', marginBottom: 20 },
  button: { backgroundColor: ACCENT_LIGHT, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
  buttonText: { color: ACCENT_DARK, fontWeight: '600', fontSize: 15 },
  details: { marginTop: 20, maxHeight: 220, alignSelf: 'stretch' },
  detailsText: { fontSize: 11, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
