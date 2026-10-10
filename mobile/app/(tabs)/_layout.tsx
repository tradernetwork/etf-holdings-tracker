import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "@/lib/theme";

// Tab names are placeholders; the information architecture is still being designed.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.bodyMedium },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          // Keep the bar clear of the gesture/nav bar on edge-to-edge Android.
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Today", tabBarIcon: ({ color, size }) => <Ionicons name="flash" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="following"
        options={{ title: "Following", tabBarIcon: ({ color, size }) => <Ionicons name="star" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: "Explore", tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
