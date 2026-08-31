import React, { useEffect } from 'react';
import { Text, Platform } from 'react-native';
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
import { useStore } from './src/store/useStore';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 12 : 8);

  return (
    <Tab.Navigator
      initialRouteName="Word Triples"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => {
          let emoji = '📌';
          
          if (route.name === 'Word Triples') {
            emoji = '📚';
          } else if (route.name === 'Sentence Trainer') {
            emoji = '💬';
          } else if (route.name === 'Dictionary') {
            emoji = '📖';
          } else if (route.name === 'Brain Workout') {
            emoji = '⚡';
          } else if (route.name === 'Statistics') {
            emoji = '📊';
          } else if (route.name === 'Settings') {
            emoji = '⚙️';
          }

          return (
            <Text style={{ fontSize: focused ? 20 : 17, opacity: focused ? 1 : 0.6, marginBottom: 2 }}>
              {emoji}
            </Text>
          );
        },
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
      <Tab.Screen 
        name="Word Triples" 
        component={WordTriplesScreen} 
        options={{ tabBarLabel: 'Слова' }}
      />
      <Tab.Screen 
        name="Sentence Trainer" 
        component={SentenceTrainerScreen} 
        options={{ tabBarLabel: 'Предложения' }}
      />
      <Tab.Screen 
        name="Brain Workout" 
        component={BrainWorkoutScreen} 
        options={{ tabBarLabel: 'Тренировка' }}
      />
      <Tab.Screen 
        name="Statistics" 
        component={StatisticsScreen} 
        options={{ tabBarLabel: 'Статистика' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={SettingsScreen} 
        options={{ tabBarLabel: 'Настройки' }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const initializeStore = useStore((state) => state.initializeStore);

  useEffect(() => {
    initializeStore();
  }, [initializeStore]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="Dictionary" component={DictionaryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

