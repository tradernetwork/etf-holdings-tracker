import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { WIDE_BREAKPOINT } from "@/lib/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

// Tab names are placeholders; the information architecture is still being designed.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  // Chromebook / tablet / landscape: side rail instead of a window-wide bottom bar.
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? "left" : "bottom",
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarActiveBackgroundColor: wide ? c.card : undefined,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.bodyMedium },
        tabBarStyle: wide
          ? { backgroundColor: c.tabBar, borderRightColor: c.border, paddingTop: insets.top + 8, width: 200, minWidth: 200, maxWidth: 200 }
          : {
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
