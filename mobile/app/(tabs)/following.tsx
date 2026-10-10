import { router } from "expo-router";
import { Text } from "react-native";
import { Card, Mono, Note, Screen, SectionHeader, Tappable } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { display, fonts } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export default function Following() {
  const { follows } = useAppState();
  const c = useTheme();
  return (
    <Screen>
      <Text style={{ color: c.textPrimary, ...display, fontSize: 30 }}>Following</Text>
      {follows.length === 0 ? (
        <Card>
          <Text style={{ color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 }}>Nothing followed yet</Text>
          <Note>
            Tap Follow on any ticker to keep it here. Follows are kept on this device for now, and alerts when a
            fund you follow changes a position are coming in a later update.
          </Note>
        </Card>
      ) : (
        <>
          <SectionHeader title={`${follows.length} followed`} />
          <Card>
            {follows.map((s) => (
              <Tappable key={s} onPress={() => router.push(`/ticker/${encodeURIComponent(s)}`)} style={{ justifyContent: "center" }}>
                <Mono bold style={{ fontSize: 18 }}>{s}</Mono>
              </Tappable>
            ))}
          </Card>
          <Note>Follows aren&apos;t saved between sessions yet, and notifications are coming later.</Note>
        </>
      )}
    </Screen>
  );
}
