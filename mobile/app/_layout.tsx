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
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppStateProvider } from "@/lib/app-state";
import { colors, fonts } from "@/lib/theme";

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

  const detail = {
    headerShown: true,
    title: "",
    headerStyle: { backgroundColor: colors.canvas },
    headerTintColor: colors.textPrimary,
    headerShadowVisible: false,
    headerBackButtonDisplayMode: "minimal" as const,
    headerTitleStyle: { fontFamily: fonts.bodyBold },
  };

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppStateProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Screen name="ticker/[symbol]" options={detail} />
            <Stack.Screen name="fund/[fund]" options={detail} />
          </Stack>
        </AppStateProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
