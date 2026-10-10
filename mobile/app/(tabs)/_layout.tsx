import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

// Tab names are placeholders; the information architecture is still being designed.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.bodyMedium },
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopColor: c.border,
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
