import type { MainTabParamList, RootStackParamList } from './src/navigation/types';
import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ACCENT } from './src/constants/theme';

import WordTriplesScreen from './src/screens/WordTriplesScreen';
import SentenceTrainerScreen from './src/screens/SentenceTrainerScreen';
import SentenceWorkshopScreen from './src/screens/SentenceWorkshopScreen';
import BookScreen from './src/screens/BookScreen';
import DictionaryScreen from './src/screens/DictionaryScreen';
import BrainWorkoutScreen from './src/screens/BrainWorkoutScreen';
import StatisticsScreen from './src/screens/StatisticsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { useStore, useHydrationState } from './src/store/useStore';

const ONBOARDING_KEY = 'papanda-onboarded';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_EMOJI: Record<string, string> = {
  Statistics: '📊',
  'Word Triples': '📚',
  'Sentence Trainer': '💬',
  'Brain Workout': '⚡',
  Settings: '⚙️',
};

// The dialectical sentence breakdown is the core of papanda, so it sits in the
// centre of the tab bar as a larger, raised button and is the first screen.
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
        const isCenter = route.name === CENTER_TAB;
        return {
          tabBarShowLabel: false,
          tabBarAccessibilityLabel: route.name,
          tabBarIcon: ({ focused }) =>
            isCenter ? (
              <View
                style={[
                  tabStyles.centerButton,
                  { backgroundColor: focused ? ACCENT : '#334155' },
                ]}
              >
                <Text allowFontScaling={false} style={tabStyles.centerEmoji}>{TAB_EMOJI[route.name]}</Text>
              </View>
            ) : (
              <Text allowFontScaling={false} style={[tabStyles.emoji, { opacity: focused ? 1 : 0.5 }]}>
                {TAB_EMOJI[route.name] ?? '📌'}
              </Text>
            ),
          tabBarActiveTintColor: ACCENT,
          tabBarInactiveTintColor: '#8E8E93',
          tabBarIconStyle: isCenter ? tabStyles.centerIcon : tabStyles.icon,
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#E2E8F0',
            borderTopWidth: 1,
            paddingTop: 6,
            paddingBottom: bottomInset,
            height: 64 + bottomInset,
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 4,
          },
          tabBarItemStyle: {
            justifyContent: 'center',
            alignItems: 'center',
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
  const hydration = useHydrationState();
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
        {hydration.error ? (
          <View style={boundaryStyles.container}>
            <Text style={boundaryStyles.sub}>{hydration.error}</Text>
            <TouchableOpacity style={boundaryStyles.button} onPress={() => void useStore.persist.rehydrate()}>
              <Text style={boundaryStyles.buttonText}>Повторить загрузку</Text>
            </TouchableOpacity>
          </View>
        ) : onboarded === null || !hydration.ready ? (
          <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
        ) : onboarded === false ? (
          <OnboardingScreen onDone={finishOnboarding} />
        ) : (
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="MainTabs" component={MainTabs} />
              <Stack.Screen name="Book" component={BookScreen} />
              <Stack.Screen name="Dictionary">
                {props => <DictionaryScreen key={progressRevision} {...props} />}
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
  icon: { width: 40, height: 40 },
  centerIcon: { width: 56, height: 56 },
  emoji: { fontSize: 24, lineHeight: 32, includeFontPadding: false, textAlign: 'center' },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Platform.OS === 'android' ? 10 : 14,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  centerEmoji: { fontSize: 26, lineHeight: 34, includeFontPadding: false, textAlign: 'center' },
});

const boundaryStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1A202C', marginBottom: 8 },
  sub: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  button: { backgroundColor: ACCENT, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  details: { marginTop: 20, maxHeight: 220, alignSelf: 'stretch' },
  detailsText: { fontSize: 11, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
