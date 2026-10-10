import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { Pressable } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppStateProvider } from "@/lib/app-state";
import { OptInSheet } from "@/components/optin-sheet";
import { fonts } from "@/lib/theme";
import { ThemeProvider, useTheme } from "@/lib/theme-context";

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  // The API client already retries with backoff; don't stack a second layer.
  defaultOptions: { queries: { retry: false } },
});

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const ready = loaded || !!fontError; // a font failure must not strand the app on the splash screen

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AppStateProvider>
            <ThemedStack />
          </AppStateProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const c = useTheme();
  const detail = {
    headerShown: true,
    title: "",
    headerStyle: { backgroundColor: c.canvas },
    headerTintColor: c.textPrimary,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: fonts.bodyBold },
    // Always show a chevron (a deep link / web reload has no history to pop): back if
    // there is somewhere to go, otherwise to Today.
    headerLeft: () => (
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 }}
      >
        <Ionicons name="chevron-back" size={26} color={c.textPrimary} />
      </Pressable>
    ),
  };
  return (
    <>
      <StatusBar style={c.statusBar} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
        <Stack.Screen name="ticker/[symbol]" options={detail} />
        <Stack.Screen name="fund/[fund]" options={detail} />
        <Stack.Screen name="settings" options={{ ...detail, title: "Settings" }} />
      </Stack>
      <OptInSheet />
    </>
  );
}
