import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import WordTriplesScreen from './src/screens/WordTriplesScreen';
import SentenceTrainerScreen from './src/screens/SentenceTrainerScreen';
import DictionaryScreen from './src/screens/DictionaryScreen';
import BrainWorkoutScreen from './src/screens/BrainWorkoutScreen';
import StatisticsScreen from './src/screens/StatisticsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_EMOJI: Record<string, string> = {
  'Word Triples': '📚',
  'Sentence Trainer': '💬',
  'Brain Workout': '⚡',
  Statistics: '📊',
  Settings: '⚙️',
};

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
        <Text style={boundaryStyles.emoji}>😕</Text>
        <Text style={boundaryStyles.title}>Что-то пошло не так</Text>
        <Text style={boundaryStyles.sub}>
          Экран не удалось показать. Попробуйте вернуться назад или перезапустить приложение.
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
  const bottomInset = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 12 : 8);

  return (
    <Tab.Navigator
      initialRouteName="Word Triples"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: focused ? 20 : 17, opacity: focused ? 1 : 0.6, marginBottom: 2 }}>
            {TAB_EMOJI[route.name] ?? '📌'}
          </Text>
        ),
        tabBarActiveTintColor: '#007BFF',
        tabBarInactiveTintColor: '#8E8E93',
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E2E8F0',
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: bottomInset,
          height: 56 + bottomInset,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 0,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
        }
      })}
    >
      <Tab.Screen name="Word Triples" component={WordTriplesScreen} options={{ tabBarLabel: 'Слова' }} />
      <Tab.Screen name="Sentence Trainer" component={SentenceTrainerScreen} options={{ tabBarLabel: 'Предложения' }} />
      <Tab.Screen name="Brain Workout" component={BrainWorkoutScreen} options={{ tabBarLabel: 'Тренировка' }} />
      <Tab.Screen name="Statistics" component={StatisticsScreen} options={{ tabBarLabel: 'Статистика' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Настройки' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  // Store hydration (and the derived `words`/`sentences` rebuild) is handled by
  // the persist `onRehydrateStorage` hook in the store itself.
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ErrorBoundary>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="Dictionary" component={DictionaryScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const boundaryStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1A202C', marginBottom: 8 },
  sub: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  button: { backgroundColor: '#007BFF', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  details: { marginTop: 20, maxHeight: 220, alignSelf: 'stretch' },
  detailsText: { fontSize: 11, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
